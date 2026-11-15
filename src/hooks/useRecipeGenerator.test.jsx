// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRecipeGenerator } from './useRecipeGenerator.js';

const recipeText = (title) =>
  JSON.stringify({ refusal: null, title, servings: 2, ingredients: [{ name: 'egg', fromPantry: true }], steps: [{ text: 'Cook.' }] });

const okResponse = (text) => new Response(JSON.stringify({ text, finishReason: 'STOP' }), { status: 200 });

/** fetch mock whose responses resolve only when we say so (ignores abort on purpose). */
function controllableFetch() {
  const pending = [];
  const fn = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  return { fn, pending };
}

afterEach(() => vi.unstubAllGlobals());

describe('useRecipeGenerator', () => {
  it('never lets an older response overwrite a newer one', async () => {
    const { fn, pending } = controllableFetch();
    vi.stubGlobal('fetch', fn);
    const onResult = vi.fn();
    const { result } = renderHook(() => useRecipeGenerator(onResult));

    act(() => {
      result.current.run({ mode: 'generate', ingredients: 'first' });
    });
    act(() => {
      result.current.run({ mode: 'generate', ingredients: 'second' });
    });
    await waitFor(() => expect(pending).toHaveLength(2));

    // Newer request finishes first, then the stale one arrives late.
    await act(async () => pending[1](okResponse(recipeText('Second'))));
    await act(async () => pending[0](okResponse(recipeText('First'))));

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0].recipe.title).toBe('Second');
    expect(result.current.status).toBe('idle');
  });

  it('retries once on malformed output, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse('{"title": "broken'))
      .mockResolvedValueOnce(okResponse(recipeText('Fixed')));
    vi.stubGlobal('fetch', fetchMock);
    const onResult = vi.fn();
    const { result } = renderHook(() => useRecipeGenerator(onResult));

    await act(async () => result.current.run({ mode: 'generate', ingredients: 'x' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls[0][0].recipe.title).toBe('Fixed');
  });

  it('surfaces a typed error after the retry also fails, without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('not json at all')));
    const onResult = vi.fn();
    const { result } = renderHook(() => useRecipeGenerator(onResult));

    await act(async () => result.current.run({ mode: 'generate', ingredients: 'x' }));

    expect(onResult).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('MALFORMED_JSON');
  });

  it('does not auto-retry transport errors like 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } }), { status: 429 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRecipeGenerator(vi.fn()));

    await act(async () => result.current.run({ mode: 'generate', ingredients: 'x' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('treats a network failure as a retryable NETWORK error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useRecipeGenerator(vi.fn()));

    await act(async () => result.current.run({ mode: 'generate', ingredients: 'x' }));

    expect(result.current.error).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('cancel (reset) drops the in-flight result', async () => {
    const { fn, pending } = controllableFetch();
    vi.stubGlobal('fetch', fn);
    const onResult = vi.fn();
    const { result } = renderHook(() => useRecipeGenerator(onResult));

    act(() => {
      result.current.run({ mode: 'generate', ingredients: 'x' });
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.reset());
    await act(async () => pending[0](okResponse(recipeText('Too late'))));

    expect(onResult).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
