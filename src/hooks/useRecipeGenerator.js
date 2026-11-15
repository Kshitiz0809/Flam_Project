import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRecipeText } from '../lib/api.js';
import { parseRecipeResponse } from '../lib/parseRecipe.js';
import { AUTO_RETRY_CODES, describeError } from '../lib/errors.js';

// 1 normal attempt + 1 silent retry when the *output* is unusable.
// Transport errors (timeouts, 429s, 5xx) are not auto-retried: those are
// surfaced with a Retry button so we don't hammer a struggling/limited API.
const MAX_ATTEMPTS = 2;

const IDLE = { status: 'idle', mode: null, startedAt: null, attempt: 0, error: null, refusal: null };

/**
 * Owns the request lifecycle for generating / refining a recipe.
 *
 * Race-safety: every run gets an incrementing id. Starting a new run (or
 * cancelling) aborts the previous fetch AND bumps the id, and results are only
 * applied if their id is still current. The abort saves bandwidth; the id
 * check is what actually guarantees a stale response can never overwrite a
 * newer one (a response can resolve after abort() is called).
 *
 * @param {(result: {recipe, warnings}, payload: object) => void} onResult
 *        called once per successful run, only for the latest request
 */
export function useRecipeGenerator(onResult) {
  const [state, setState] = useState(IDLE);
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const lastRunRef = useRef(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
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

    setState({ ...IDLE, status: 'loading', mode: payload.mode, startedAt: Date.now(), attempt: 1 });

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) setState((s) => ({ ...s, attempt }));
      try {
        const { text, finishReason } = await fetchRecipeText(payload, { signal: controller.signal, attempt, fault });
        if (!isCurrent()) return;
        const result = parseRecipeResponse(text, finishReason);
        if (!isCurrent()) return;

        if (!result.ok) {
          setState({ ...IDLE, status: 'refused', mode: payload.mode, refusal: result.refusal });
          return;
        }
        setState(IDLE);
        onResultRef.current?.(result, payload);
        return;
      } catch (err) {
        if (!isCurrent()) return; // superseded or cancelled — drop silently
        lastError = err;
        if (import.meta.env.DEV) console.warn(`[recipe] attempt ${attempt} failed:`, err.code, err.message);
        if (!AUTO_RETRY_CODES.has(err.code)) break;
      }
    }

    if (isCurrent()) {
      setState({ ...IDLE, status: 'error', mode: payload.mode, error: describeError(lastError) });
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
