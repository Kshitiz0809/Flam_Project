// Minimal Gemini REST client. No SDK on purpose: it's one POST, and doing it by
// hand makes every failure mode (HTTP errors, safety blocks, truncation)
// visible and explainable.
import { ApiError } from './errors.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Calls Gemini with JSON-mode output and returns the model's raw text.
 * Parsing/validation of that text happens on the client (src/lib/parse*.js).
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemInstruction
 * @param {Array<object>} opts.parts   user-turn parts: { text } and/or { inlineData: { mimeType, data } }
 * @param {object} opts.schema         Gemini responseSchema (OpenAPI subset)
 * @param {number} [opts.temperature]
 * @param {AbortSignal} opts.signal    aborted on timeout or client disconnect
 * @returns {Promise<{ text: string, finishReason: string | null }>}
 */
export async function callGemini({ apiKey, model, systemInstruction, parts, schema, temperature = 0.7, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
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
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'].includes(finishReason)) {
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
  if (res.status === 400 && /image|inline_data|mime/i.test(upstreamMsg)) {
    return new ApiError(400, 'BAD_REQUEST', "The AI couldn't read that image. Try a JPEG or PNG photo.");
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
