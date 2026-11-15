// Minimal Groq client (OpenAI-compatible chat completions API), no SDK.
// Same contract as callGemini(): returns { text, finishReason } or throws ApiError.
import { ApiError } from './errors.js';

const API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';

// Groq's current models (gpt-oss, Qwen) "reason" before answering. Low effort
// is plenty for a recipe and keeps responses around 1-2s. Models that reject
// the parameter are remembered and called without it.
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT ?? 'low';
const rejectsReasoningEffort = new Set();

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemInstruction
 * @param {Array<object>} opts.parts   { text } and/or { inlineData: { mimeType, data } }
 * @param {object} opts.schema         Gemini-style schema; sent to the model as a JSON Schema in the prompt
 * @param {number} [opts.temperature]
 * @param {AbortSignal} opts.signal
 */
export async function callGroq(opts) {
  const useEffort = Boolean(REASONING_EFFORT) && !rejectsReasoningEffort.has(opts.model);
  try {
    return await requestGroq(opts, useEffort);
  } catch (err) {
    if (err.code !== 'REASONING_UNSUPPORTED') throw err;
    rejectsReasoningEffort.add(opts.model);
    console.warn(`[api] ${opts.model} rejected reasoning_effort; retrying without it`);
    return requestGroq(opts, false);
  }
}

async function requestGroq({ apiKey, model, systemInstruction, parts, schema, temperature = 0.7, signal }, useEffort) {
  const hasImage = parts.some((p) => p.inlineData);
  const content = hasImage
    ? parts.map((p) =>
        p.inlineData
          ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
          : { type: 'text', text: p.text },
      )
    : parts.map((p) => p.text).join('\n');

  const body = {
    model,
    temperature,
    max_completion_tokens: 8192, // includes reasoning tokens
    ...(useEffort ? { reasoning_effort: REASONING_EFFORT } : {}),
    // JSON mode guarantees syntactically valid JSON (or a 400), but NOT the
    // shape — so the schema goes in the prompt and the client validates.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${systemInstruction}\n\nReturn a single JSON object that follows this JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}` },
      { role: 'user', content },
    ],
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err; // handled by caller
    throw new ApiError(502, 'UPSTREAM_UNREACHABLE', `Could not reach Groq: ${err.message}`, { retryable: true });
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const e = data?.error ?? {};
    // JSON mode: the model produced invalid JSON. Hand the raw attempt to the
    // client so its parser can try to salvage it (or auto-retry).
    if (e.code === 'json_validate_failed' && typeof e.failed_generation === 'string') {
      return { text: e.failed_generation, finishReason: 'STOP' };
    }
    throw toApiError(res.status, e);
  }

  const choice = data?.choices?.[0];
  if (!choice) throw new ApiError(502, 'UPSTREAM_ERROR', 'Groq returned no choices', { retryable: true });
  const finishReason = choice.finish_reason === 'length' ? 'MAX_TOKENS' : (choice.finish_reason ?? null);
  return { text: choice.message?.content ?? '', finishReason };
}

function toApiError(status, e) {
  const msg = e.message || `HTTP ${status}`;
  if (status === 400 && /reasoning/i.test(msg)) return new ApiError(400, 'REASONING_UNSUPPORTED', msg);
  if (status === 400 && /content must be a string|image|vision/i.test(msg)) {
    return new ApiError(500, 'MODEL_NOT_FOUND', `Model can't read images: ${msg}`); // lets the fallback chain try the next model
  }
  if (status === 429) return new ApiError(429, 'RATE_LIMITED', msg, { retryable: true });
  if (status === 401 || status === 403) return new ApiError(500, 'CONFIG', `Groq rejected the API key: ${msg}`);
  if (status === 404 || e.code === 'model_not_found' || e.code === 'model_decommissioned') {
    return new ApiError(500, 'MODEL_NOT_FOUND', `Groq model unavailable: ${msg}`);
  }
  if (status === 413) return new ApiError(400, 'BAD_REQUEST', 'That photo is too large for the AI. Try a smaller one.');
  if (status === 498 || status === 503) return new ApiError(503, 'OVERLOADED', msg, { retryable: true });
  if (status >= 500) return new ApiError(502, 'UPSTREAM_ERROR', msg, { retryable: true });
  return new ApiError(502, 'UPSTREAM_ERROR', `Groq ${status}: ${msg}`);
}

/** Gemini's OpenAPI-subset schema (type: 'OBJECT', nullable) → standard JSON Schema. */
export function toJsonSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  const type = s.type?.toLowerCase();
  if (type) out.type = s.nullable ? [type, 'null'] : type;
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (s.required) out.required = s.required;
  return out;
}
