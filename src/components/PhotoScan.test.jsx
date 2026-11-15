// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import PhotoScan from './PhotoScan.jsx';
import { AppError } from '../lib/errors.js';

// jsdom has no canvas, so stub the resize/encode step.
vi.mock('../lib/image.js', () => ({ prepareImage: vi.fn() }));
import { prepareImage } from '../lib/image.js';

const SCAN = {
  refusal: null,
  ingredients: [
    { name: 'eggs', amount: '6', confidence: 'high' },
    { name: 'spinach', amount: '', confidence: 'medium' },
    { name: 'pesto', amount: '1 jar', confidence: 'low' },
  ],
};

let responses;

function Harness({ initial = '' }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <output data-testid="text">{text}</output>
      <PhotoScan ingredientsText={text} onAdd={(t) => setText((cur) => (cur ? `${cur}, ${t}` : t))} />
    </>
  );
}

const pickFile = () => {
  const input = document.querySelector('input[type=file]');
  fireEvent.change(input, { target: { files: [new File(['x'], 'fridge.jpg', { type: 'image/jpeg' })] } });
};

beforeEach(() => {
  responses = [];
  globalThis.URL.createObjectURL ??= () => 'blob:mock';
  globalThis.URL.revokeObjectURL ??= () => {};
  prepareImage.mockResolvedValue({ mimeType: 'image/jpeg', data: 'aGVsbG8=', previewUrl: 'blob:preview' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = responses.shift() ?? { text: JSON.stringify(SCAN), finishReason: 'STOP' };
      return new Response(JSON.stringify(next), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PhotoScan', () => {
  it('detects items, leaves low-confidence ones unticked, and adds only confirmed ones', async () => {
    render(<Harness initial="rice" />);
    pickFile();

    expect(await screen.findByText(/found 3/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /pesto/i }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: /eggs/i }).checked).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /spinach/i })); // untick
    fireEvent.click(screen.getByRole('button', { name: /add 1 to my list/i }));

    expect(screen.getByTestId('text').textContent).toBe('rice, eggs (6)');
    expect(screen.getByText(/scan a photo/i)).toBeTruthy(); // panel closed
  });

  it('sends the prepared image to /api/scan', async () => {
    render(<Harness />);
    pickFile();
    await screen.findByText(/found 3/i);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/scan');
    expect(JSON.parse(init.body)).toEqual({ mimeType: 'image/jpeg', data: 'aGVsbG8=' });
  });

  it('shows a helpful error for unreadable images (e.g. HEIC) without calling the API', async () => {
    prepareImage.mockRejectedValueOnce(new AppError('IMAGE_UNREADABLE', 'decode failed'));
    render(<Harness />);
    pickFile();
    expect(await screen.findByText(/couldn't open that photo/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/choose another photo/i)).toBeTruthy();
  });

  it('auto-retries garbled output, then offers Try again', async () => {
    responses = [{ text: '{"ingredients": [', finishReason: 'STOP' }, { text: 'nope', finishReason: 'STOP' }];
    render(<Harness />);
    pickFile();
    expect(await screen.findByText(/garbled/i)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/found 3/i)).toBeTruthy();
  });

  it('handles "no food" refusals and empty results', async () => {
    responses = [{ text: JSON.stringify({ refusal: 'That is a cat.', ingredients: [] }), finishReason: 'STOP' }];
    render(<Harness />);
    pickFile();
    expect(await screen.findByText('That is a cat.')).toBeTruthy();

    responses = [{ text: JSON.stringify({ refusal: null, ingredients: [] }), finishReason: 'STOP' }];
    pickFile();
    expect(await screen.findByText(/didn't spot any ingredients/i)).toBeTruthy();
  });
});
