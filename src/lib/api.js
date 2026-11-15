// Network layer: one function that turns "POST /api/recipe" into either
// `{ text, finishReason }` or a typed AppError. It never parses the recipe.
import { AppError } from './errors.js';

// Slightly longer than the server's own 45s Gemini timeout, so normally the
// server reports TIMEOUT first; this is the backstop if the server hangs.
const CLIENT_TIMEOUT_MS = 60_000;

/**
 * @param {object} payload            request body for /api/recipe
 * @param {object} opts
 * @param {AbortSignal} opts.signal   aborted when the request is superseded/cancelled
 * @param {number} [opts.attempt]
 * @param {string} [opts.fault]       dev-only fault injection
 */
export async function fetchRecipeText(payload, { signal, attempt = 1, fault } = {}) {
  // Link the caller's signal with our own timeout.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CLIENT_TIMEOUT_MS);

  try {
    const headers = { 'content-type': 'application/json', 'x-attempt': String(attempt) };
    if (fault) headers['x-simulate-fault'] = fault;

    let res;
    try {
      res = await fetch('/api/recipe', { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        if (timedOut) throw new AppError('TIMEOUT', 'No response from the server', { retryable: true });
        throw err; // genuine cancellation — caller ignores it
      }
      throw new AppError('NETWORK', err.message, { retryable: true });
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const e = body?.error;
      if (e?.code) throw new AppError(e.code, e.message, { retryable: e.retryable });
      // Not our JSON error (e.g. the Vite proxy's 502 when the API is down).
      throw new AppError(res.status >= 500 ? 'NETWORK' : 'UNKNOWN', `HTTP ${res.status}`, { retryable: true });
    }
    if (!body || typeof body.text !== 'string') {
      throw new AppError('UNKNOWN', 'Unexpected response from the server', { retryable: true });
    }
    return { text: body.text, finishReason: body.finishReason ?? null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
