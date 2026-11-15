// Minimal Gemini REST client. No SDK on purpose: it's one POST, and doing it by
// hand makes every failure mode (HTTP errors, safety blocks, truncation)
// visible and explainable.
import { ApiError } from './errors.js';

const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

// "Thinking" adds a lot of latency and isn't needed to write a recipe as JSON,
// so we ask for none. Some models refuse that setting; remember those and
// send the request without it from then on.
const LOW_THINKING = process.env.GEMINI_LOW_THINKING !== '0';
const rejectsThinkingConfig = new Set();

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
export async function callGemini(opts) {
  try {
    return await requestGemini(opts, LOW_THINKING && !rejectsThinkingConfig.has(opts.model));
  } catch (err) {
    if (err.code !== 'THINKING_UNSUPPORTED') throw err;
    rejectsThinkingConfig.add(opts.model);
    console.warn(`[api] ${opts.model} rejected thinkingConfig; retrying without it`);
    return requestGemini(opts, false);
  }
}

async function requestGemini({ apiKey, model, systemInstruction, parts, schema, temperature = 0.7, signal }, lowThinking) {
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
      maxOutputTokens: 8192,
      ...(lowThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err; // handled by caller
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
  if (res.status === 503) {
    // Gemini's "model is overloaded / experiencing high demand"
    return new ApiError(503, 'OVERLOADED', upstreamMsg, { retryable: true });
  }
  if (res.status === 400 && /think/i.test(upstreamMsg)) {
    return new ApiError(400, 'THINKING_UNSUPPORTED', upstreamMsg);
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
    return new ApiError(500, 'MODEL_NOT_FOUND', `Model not found — check GEMINI_MODEL: ${upstreamMsg}`);
  }
  if (res.status >= 500) {
    return new ApiError(502, 'UPSTREAM_ERROR', upstreamMsg, { retryable: true });
  }
  return new ApiError(502, 'UPSTREAM_ERROR', `Gemini ${res.status}: ${upstreamMsg}`);
}
