import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_RETRY_CODES, describeError } from '../lib/errors.js';

// 1 normal attempt + 1 silent retry when the *output* is unusable.
// Transport errors (timeouts, 429s, 5xx) are not auto-retried: those are
// surfaced with a Retry button so we don't hammer a struggling/limited API.
const MAX_ATTEMPTS = 2;

const IDLE = { status: 'idle', mode: null, startedAt: null, attempt: 0, error: null, refusal: null };

/**
 * Generic request lifecycle for any "send to model → parse JSON" call.
 * Used by useRecipeGenerator (recipes) and useIngredientScan (photos).
 *
 * Race-safety: every run gets an incrementing id. Starting a new run (or
 * cancelling) aborts the previous fetch AND bumps the id, and results are only
 * applied if their id is still current. The abort saves bandwidth; the id
 * check is what actually guarantees a stale response can never overwrite a
 * newer one (a response can resolve after abort() is called).
 *
 * @param {object} opts
 * @param {(payload, { signal, attempt, fault }) => Promise<{text, finishReason}>} opts.send
 * @param {(text, finishReason) => ({ ok: true } & object) | { ok: false, refusal: string }} opts.parse
 *        throws an AppError for unusable output
 * @param {(result, payload) => void} [opts.onResult]
 *        called once per successful run, only for the latest request
 */
export function useAiRequest({ send, parse, onResult }) {
  const [state, setState] = useState(IDLE);
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const lastRunRef = useRef(null);
  const fnsRef = useRef({ send, parse, onResult });

  useEffect(() => {
    fnsRef.current = { send, parse, onResult };
  });

  // Abort anything in flight on unmount.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async (payload, { fault } = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === id;
    lastRunRef.current = { payload, fault };

    setState({ ...IDLE, status: 'loading', mode: payload.mode ?? null, startedAt: Date.now(), attempt: 1 });

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) setState((s) => ({ ...s, attempt }));
      try {
        const { text, finishReason } = await fnsRef.current.send(payload, { signal: controller.signal, attempt, fault });
        if (!isCurrent()) return;
        const result = fnsRef.current.parse(text, finishReason);
        if (!isCurrent()) return;

        if (!result.ok) {
          setState({ ...IDLE, status: 'refused', mode: payload.mode ?? null, refusal: result.refusal });
          return;
        }
        setState(IDLE);
        fnsRef.current.onResult?.(result, payload);
        return;
      } catch (err) {
        if (!isCurrent()) return; // superseded or cancelled — drop silently
        lastError = err;
        if (import.meta.env.DEV) console.warn(`[ai] attempt ${attempt} failed:`, err.code, err.message);
        if (!AUTO_RETRY_CODES.has(err.code)) break;
      }
    }

    if (isCurrent()) {
      setState({ ...IDLE, status: 'error', mode: payload.mode ?? null, error: describeError(lastError) });
    }
  }, []);

  const retry = useCallback(() => {
    if (lastRunRef.current) run(lastRunRef.current.payload, { fault: lastRunRef.current.fault });
  }, [run]);

  /** Cancel any in-flight request and clear loading/error state. */
  const reset = useCallback(() => {
    requestIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(IDLE);
  }, []);

  return { ...state, isLoading: state.status === 'loading', run, retry, reset };
}
