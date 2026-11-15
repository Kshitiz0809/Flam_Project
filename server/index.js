// Tiny backend whose only job is to keep the Gemini API key off the browser.
//
//   POST /api/recipe  → { text, finishReason }  (raw model text; client parses)
//                     → { error: { code, message, retryable } } on failure
//   GET  /api/health  → { ok, model, mock, faults }
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ApiError } from './errors.js';
import { generateRecipeText } from './gemini.js';
import { buildUserPrompt } from './prompt.js';
import { applyFault, FAULTS, SAMPLE_RECIPE } from './faults.js';

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45_000;
const API_KEY = process.env.GEMINI_API_KEY?.trim();
const MOCK = process.env.MOCK_LLM === '1';
const SERVE_STATIC = process.argv.includes('--serve-static');
const ALLOW_FAULTS = process.env.ALLOW_FAULT_INJECTION
  ? process.env.ALLOW_FAULT_INJECTION === '1'
  : !SERVE_STATIC;

const LIMITS = { ingredients: 2000, instruction: 500, recipeJson: 30_000 };
const DIETS = new Set(['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free']);

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MOCK ? 'mock' : MODEL, mock: MOCK, keyConfigured: Boolean(API_KEY), faults: ALLOW_FAULTS ? FAULTS : [] });
});

app.post('/api/recipe', async (req, res) => {
  const controller = new AbortController();
  // If the browser cancels (new request, Cancel button, tab closed), stop
  // waiting on Gemini too — no point paying for a response nobody will see.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const fault = ALLOW_FAULTS ? req.get('x-simulate-fault') : undefined;
  const attempt = Number(req.get('x-attempt')) || 1;
  const timeoutMs = fault === 'timeout' ? 3_000 : TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const body = validateBody(req.body);

    let result = fault ? await applyFault(fault, { attempt, signal: controller.signal }) : null;

    if (!result) {
      if (MOCK) {
        result = { text: JSON.stringify({ ...SAMPLE_RECIPE, servings: body.servings }), finishReason: 'STOP' };
      } else {
        if (!API_KEY) {
          throw new ApiError(500, 'CONFIG', 'GEMINI_API_KEY is not set on the server (see .env.example)');
        }
        result = await generateRecipeText({
          apiKey: API_KEY,
          model: MODEL,
          prompt: buildUserPrompt(body),
          signal: controller.signal,
        });
      }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!timedOut) return; // client went away; nothing to send
      err = new ApiError(504, 'TIMEOUT', `The model did not respond within ${Math.round(timeoutMs / 1000)}s`, { retryable: true });
    }
    if (!(err instanceof ApiError)) {
      console.error('[api] unexpected error', err);
      err = new ApiError(500, 'INTERNAL', 'Unexpected server error', { retryable: true });
    } else if (err.status >= 500) {
      console.warn(`[api] ${err.code}: ${err.message}`);
    }
    if (!res.headersSent) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.retryable } });
    }
  } finally {
    clearTimeout(timer);
  }
});

/** Server-side input validation: never trust the client either. */
function validateBody(body) {
  const bad = (msg) => new ApiError(400, 'BAD_REQUEST', msg);
  if (!body || typeof body !== 'object') throw bad('Expected a JSON body');

  const ingredients = typeof body.ingredients === 'string' ? body.ingredients.trim() : '';
  if (!ingredients) throw bad('Please list at least one ingredient');
  if (ingredients.length > LIMITS.ingredients) throw bad(`Ingredient list is too long (max ${LIMITS.ingredients} characters)`);

  const servings = Number(body.servings ?? 2);
  if (!Number.isInteger(servings) || servings < 1 || servings > 12) throw bad('Servings must be 1–12');

  const diet = Array.isArray(body.diet) ? body.diet.filter((d) => DIETS.has(d)) : [];

  const mode = body.mode === 'refine' ? 'refine' : 'generate';
  if (mode === 'generate') return { mode, ingredients, servings, diet };

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) throw bad('Describe what to change');
  if (instruction.length > LIMITS.instruction) throw bad(`Change request is too long (max ${LIMITS.instruction} characters)`);
  if (!body.recipe || typeof body.recipe !== 'object') throw bad('Missing the recipe to refine');
  if (JSON.stringify(body.recipe).length > LIMITS.recipeJson) throw bad('Recipe is too large to refine');

  return { mode, ingredients, servings, diet, instruction, recipe: body.recipe };
}

// Unknown /api routes → JSON 404 rather than the SPA's index.html.
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route', retryable: false } }));

// Body-parser failures (invalid JSON, payload too large) → JSON, never an HTML stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('[api] unhandled', err);
  const message = err.type === 'entity.too.large' ? 'Request is too large' : status === 400 ? 'Request body is not valid JSON' : 'Unexpected server error';
  res.status(status).json({ error: { code: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', message, retryable: status === 500 } });
});

if (SERVE_STATIC) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (!existsSync(dist)) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(1);
  }
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  const mode = MOCK ? 'MOCK (canned recipe)' : API_KEY ? `Gemini model "${MODEL}"` : 'NO API KEY — set GEMINI_API_KEY in .env';
  console.log(`[api] listening on http://localhost:${PORT} · ${mode}${ALLOW_FAULTS ? ' · fault injection on' : ''}`);
});
