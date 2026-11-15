// Tiny backend whose only job is to keep the Gemini API key off the browser.
//
//   POST /api/recipe  → { text, finishReason }  (raw model text; client parses)
//   POST /api/scan    → { text, finishReason }  (ingredients seen in a photo)
//                     → { error: { code, message, retryable } } on failure
//   GET  /api/health  → { ok, model, mock, faults }
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ApiError } from './errors.js';
import { callGemini } from './gemini.js';
import { buildUserPrompt, RECIPE_SCHEMA, SCAN_INSTRUCTION, SCAN_SCHEMA, SCAN_USER_TEXT, SYSTEM_INSTRUCTION } from './prompt.js';
import { applyFault, FAULTS, SAMPLE_RECIPE, SAMPLE_SCAN } from './faults.js';
import { rateLimit } from './rateLimit.js';

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45_000;
const API_KEY = process.env.GEMINI_API_KEY?.trim();
const MOCK = process.env.MOCK_LLM === '1';
const SERVE_STATIC = process.argv.includes('--serve-static');
const ALLOW_FAULTS = process.env.ALLOW_FAULT_INJECTION
  ? process.env.ALLOW_FAULT_INJECTION === '1'
  : !SERVE_STATIC;
// Rate limiting is on by default only in production mode (`npm run serve`).
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? (SERVE_STATIC ? 40 : 0));

const LIMITS = { ingredients: 2000, instruction: 500, recipeJson: 30_000, imageBase64: 5_500_000 };
const DIETS = new Set(['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const app = express();
app.disable('x-powered-by');
// Behind Render's (or any) reverse proxy, trust one hop so req.ip is the real client IP.
if (process.env.TRUST_PROXY !== '0' && SERVE_STATIC) app.set('trust proxy', 1);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MOCK ? 'mock' : MODEL, mock: MOCK, keyConfigured: Boolean(API_KEY), faults: ALLOW_FAULTS ? FAULTS : [] });
});

const limiter = RATE_LIMIT_MAX > 0 ? rateLimit({ max: RATE_LIMIT_MAX, windowMs: 10 * 60_000 }) : (_req, _res, next) => next();

/**
 * Shared lifecycle for every model-backed route: input validation, timeout,
 * abort-on-disconnect, fault injection, mock mode and error mapping.
 */
function aiRoute({ kind, validate, mock, run }) {
  return async (req, res) => {
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
      const body = validate(req.body);

      let result = fault ? await applyFault(fault, { kind, attempt, signal: controller.signal }) : null;

      if (!result) {
        if (MOCK) {
          await new Promise((r) => setTimeout(r, 900)); // feel like a real call
          result = { text: JSON.stringify(mock(body)), finishReason: 'STOP' };
        } else {
          if (!API_KEY) {
            throw new ApiError(500, 'CONFIG', 'GEMINI_API_KEY is not set on the server (see .env.example)');
          }
          result = await callGemini({ apiKey: API_KEY, model: MODEL, signal: controller.signal, ...run(body) });
        }
      }

      res.json(result);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!timedOut) return; // client went away; nothing to send
        err = new ApiError(504, 'TIMEOUT', `The model did not respond within ${Math.round(timeoutMs / 1000)}s`, { retryable: true });
      }
      sendError(res, err);
    } finally {
      clearTimeout(timer);
    }
  };
}

app.post(
  '/api/recipe',
  limiter,
  express.json({ limit: '100kb' }),
  aiRoute({
    kind: 'recipe',
    validate: validateRecipeBody,
    mock: (body) => ({ ...SAMPLE_RECIPE, servings: body.servings }),
    run: (body) => ({ systemInstruction: SYSTEM_INSTRUCTION, schema: RECIPE_SCHEMA, parts: [{ text: buildUserPrompt(body) }] }),
  }),
);

app.post(
  '/api/scan',
  limiter,
  express.json({ limit: '6mb' }),
  aiRoute({
    kind: 'scan',
    validate: validateScanBody,
    mock: () => SAMPLE_SCAN,
    run: (body) => ({
      systemInstruction: SCAN_INSTRUCTION,
      schema: SCAN_SCHEMA,
      temperature: 0.2, // identification, not creativity
      parts: [{ inlineData: { mimeType: body.mimeType, data: body.data } }, { text: SCAN_USER_TEXT }],
    }),
  }),
);

/** Server-side input validation: never trust the client either. */
function validateRecipeBody(body) {
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

function validateScanBody(body) {
  const bad = (msg) => new ApiError(400, 'BAD_REQUEST', msg);
  if (!body || typeof body !== 'object') throw bad('Expected a JSON body');
  const { mimeType, data } = body;
  if (!IMAGE_TYPES.has(mimeType)) throw bad('Photo must be a JPEG, PNG or WebP image');
  if (typeof data !== 'string' || !data) throw bad('Missing photo data');
  if (data.length > LIMITS.imageBase64) throw bad('Photo is too large');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw bad('Photo data is not valid base64');
  return { mimeType, data };
}

function sendError(res, err) {
  if (!(err instanceof ApiError)) {
    console.error('[api] unexpected error', err);
    err = new ApiError(500, 'INTERNAL', 'Unexpected server error', { retryable: true });
  } else if (err.status >= 500) {
    console.warn(`[api] ${err.code}: ${err.message}`);
  }
  if (!res.headersSent) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: err.retryable } });
  }
}

// Unknown /api routes → JSON 404 rather than the SPA's index.html.
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route', retryable: false } }));

if (SERVE_STATIC) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (!existsSync(dist)) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html'), { headers: { 'cache-control': 'no-cache' } }));
}

// Errors passed to next(): rate limiter, body-parser (invalid JSON, payload
// too large). Always JSON, never an HTML stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) return sendError(res, err);
  const status = err.status && err.status < 500 ? err.status : 500;
  const message =
    err.type === 'entity.too.large' ? 'Request is too large' : status === 400 ? 'Request body is not valid JSON' : 'Unexpected server error';
  sendError(res, new ApiError(status, status === 500 ? 'INTERNAL' : 'BAD_REQUEST', message, { retryable: status === 500 }));
});

app.listen(PORT, () => {
  const mode = MOCK ? 'MOCK (canned responses)' : API_KEY ? `Gemini model "${MODEL}"` : 'NO API KEY — set GEMINI_API_KEY';
  const extras = [ALLOW_FAULTS && 'fault injection on', RATE_LIMIT_MAX > 0 && `rate limit ${RATE_LIMIT_MAX}/10min per IP`].filter(Boolean);
  console.log(`[api] listening on http://localhost:${PORT} · ${mode}${extras.length ? ' · ' + extras.join(' · ') : ''}`);
});
