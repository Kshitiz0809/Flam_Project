import { describe, expect, it, vi } from 'vitest';
import { callWithFallback } from './fallback.js';
import { ApiError } from './errors.js';

const models = ['primary', 'lite'];
const run = (call, signal = new AbortController().signal) => callWithFallback({ models, attemptTimeoutMs: 50, signal, call });

describe('callWithFallback', () => {
  it('uses the primary model when it works', async () => {
    const call = vi.fn(async () => ({ text: 'ok' }));
    await expect(run(call)).resolves.toEqual({ text: 'ok', model: 'primary' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each(['OVERLOADED', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'MODEL_NOT_FOUND'])('falls back on %s', async (code) => {
    const call = vi.fn(async (model) => {
      if (model === 'primary') throw new ApiError(503, code, 'nope', { retryable: true });
      return { text: 'from lite' };
    });
    await expect(run(call)).resolves.toEqual({ text: 'from lite', model: 'lite' });
  });

  it('falls back when the primary is too slow', async () => {
    const call = (model, signal) =>
      model === 'primary'
        ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
        : Promise.resolve({ text: 'fast' });
    await expect(run(call)).resolves.toEqual({ text: 'fast', model: 'lite' });
  });

  it('does not fall back on content/config problems', async () => {
    const call = vi.fn(async () => {
      throw new ApiError(422, 'BLOCKED', 'safety');
    });
    await expect(run(call)).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('reports the last model error when every model fails', async () => {
    const call = async (model) => {
      throw new ApiError(503, 'OVERLOADED', `${model} busy`, { retryable: true });
    };
    await expect(run(call)).rejects.toMatchObject({ code: 'OVERLOADED', message: 'lite busy' });
  });

  it('stops immediately when the overall request is aborted', async () => {
    const controller = new AbortController();
    const call = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    await expect(run(call, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
