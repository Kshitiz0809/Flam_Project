// Model fallback chain.
//
// On the free tier, a model can be overloaded (503 "high demand"), rate
// limited (429) or just slow. Each model has its own capacity and its own
// quota, so instead of failing, we retry the same request on the next model in
// the chain — within one user request and one overall time budget.
import { ApiError } from './errors.js';

// Problems with *this model right now* → worth trying another model.
// Not included: BLOCKED (content issue), BAD_REQUEST, CONFIG (bad key) —
// another model wouldn't fix those.
const FALLBACK_CODES = new Set(['OVERLOADED', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'UPSTREAM_UNREACHABLE', 'TIMEOUT', 'MODEL_NOT_FOUND']);

/**
 * @param {object} opts
 * @param {string[]} opts.models             in order of preference
 * @param {number} opts.attemptTimeoutMs     per-model cap (the last model gets whatever time is left)
 * @param {AbortSignal} opts.signal          overall deadline / client disconnect
 * @param {(model: string, signal: AbortSignal) => Promise<object>} opts.call
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<object>} the call's result plus `{ model }`
 */
export async function callWithFallback({ models, attemptTimeoutMs, signal, call, log = () => {} }) {
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isLast = i === models.length - 1;
    const attemptSignal = isLast ? signal : AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]);

    try {
      return { ...(await call(model, attemptSignal)), model };
    } catch (err) {
      // Overall deadline hit or the browser went away: stop, let the caller handle it.
      if (signal.aborted) throw err;

      const error =
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? new ApiError(504, 'TIMEOUT', `${model} did not respond within ${Math.round(attemptTimeoutMs / 1000)}s`, { retryable: true })
          : err;

      if (isLast || !(error instanceof ApiError) || !FALLBACK_CODES.has(error.code)) throw error;
      log(`[api] ${model} failed (${error.code}: ${error.message}) → trying ${models[i + 1]}`);
    }
  }
  throw new ApiError(500, 'CONFIG', 'No models configured');
}
