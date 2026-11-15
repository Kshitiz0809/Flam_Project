// Minimal Gemini REST client. No SDK on purpose: it's one POST, and doing it by
// hand makes every failure mode (HTTP errors, safety blocks, truncation)
// visible and explainable.
import { ApiError } from './errors.js';
import { RECIPE_SCHEMA, SYSTEM_INSTRUCTION } from './prompt.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Calls Gemini and returns the model's raw text. Parsing/validation of that
 * text happens on the client (see src/lib/parseRecipe.js).
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.prompt
 * @param {AbortSignal} opts.signal  aborted on timeout or client disconnect
 * @returns {Promise<{ text: string, finishReason: string | null }>}
 */
export async function generateRecipeText({ apiKey, model, prompt, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECIPE_SCHEMA,
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  let res;
  try {
    res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err; // handled by caller (timeout vs disconnect)
    throw new ApiError(502, 'UPSTREAM_UNREACHABLE', `Could not reach Gemini: ${err.message}`, {
      retryable: true,
    });
  }

  if (!res.ok) throw await toApiError(res);

  const data = await res.json().catch(() => null);
  if (!data) throw new ApiError(502, 'UPSTREAM_ERROR', 'Gemini returned a non-JSON envelope', { retryable: true });

  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ApiError(422, 'BLOCKED', `Prompt blocked by safety filter (${blockReason})`);
  }

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finishReason)) {
    throw new ApiError(422, 'BLOCKED', `Response blocked (${finishReason})`);
  }

  // Skip "thought" parts some models emit; concatenate the rest.
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');

  return { text, finishReason };
}

async function toApiError(res) {
  const payload = await res.json().catch(() => null);
  const upstreamMsg = payload?.error?.message || res.statusText;

  if (res.status === 429) {
    return new ApiError(429, 'RATE_LIMITED', upstreamMsg, { retryable: true });
  }
  if (res.status === 400 && /api key/i.test(upstreamMsg)) {
    return new ApiError(500, 'CONFIG', `Gemini rejected the API key: ${upstreamMsg}`);
  }
  if (res.status === 401 || res.status === 403) {
    return new ApiError(500, 'CONFIG', `Gemini auth failed: ${upstreamMsg}`);
  }
  if (res.status === 404) {
    return new ApiError(500, 'CONFIG', `Model not found — check GEMINI_MODEL: ${upstreamMsg}`);
  }
  if (res.status >= 500) {
    return new ApiError(502, 'UPSTREAM_ERROR', upstreamMsg, { retryable: true });
  }
  return new ApiError(502, 'UPSTREAM_ERROR', `Gemini ${res.status}: ${upstreamMsg}`);
}
