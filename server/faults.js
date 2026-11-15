// Development-only fault injection, so every failure path in the UI can be
// exercised (and recorded for the demo) without waiting for the real model to
// misbehave. Triggered by the `x-simulate-fault` request header, which the
// server ignores unless fault injection is enabled (never in --serve-static).
import { ApiError } from './errors.js';

export const SAMPLE_RECIPE = {
  refusal: null,
  title: 'Garlicky Tomato & Spinach Pasta',
  description: 'A quick weeknight pasta built from pantry staples and whatever greens you have.',
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 15,
  ingredients: [
    { name: 'spaghetti', quantity: 200, unit: 'g', note: '', fromPantry: true, swaps: [{ name: 'penne', quantity: 200, unit: 'g', note: 'any dried pasta works' }, { name: 'zucchini noodles', quantity: 300, unit: 'g', note: 'low-carb, skip boiling' }] },
    { name: 'cherry tomatoes', quantity: 250, unit: 'g', note: 'halved', fromPantry: true, swaps: [{ name: 'canned chopped tomatoes', quantity: 400, unit: 'g', note: 'simmer 5 min longer' }] },
    { name: 'garlic', quantity: 3, unit: 'clove', note: 'thinly sliced', fromPantry: true, swaps: [{ name: 'garlic powder', quantity: 0.5, unit: 'tsp', note: 'milder flavour' }] },
    { name: 'baby spinach', quantity: 2, unit: 'cup', note: '', fromPantry: true, swaps: [{ name: 'kale', quantity: 1.5, unit: 'cup', note: 'chop finely, cook 2 min longer' }] },
    { name: 'olive oil', quantity: 2, unit: 'tbsp', note: '', fromPantry: true, swaps: [{ name: 'butter', quantity: 2, unit: 'tbsp', note: 'richer sauce' }] },
    { name: 'parmesan', quantity: 30, unit: 'g', note: 'grated', fromPantry: false, swaps: [{ name: 'nutritional yeast', quantity: 2, unit: 'tbsp', note: 'vegan' }] },
    { name: 'salt', quantity: null, unit: '', note: 'to taste', fromPantry: true, swaps: [] },
  ],
  steps: [
    { text: 'Bring a large pot of salted water to the boil and cook the spaghetti until al dente.', minutes: 10 },
    { text: 'Meanwhile, warm the olive oil in a wide pan and gently fry the garlic until golden.', minutes: 2 },
    { text: 'Add the cherry tomatoes and cook until they burst and turn saucy.', minutes: 5 },
    { text: 'Stir in the spinach until just wilted.', minutes: 1 },
    { text: 'Toss the drained pasta into the pan with a splash of pasta water; season with salt.', minutes: 1 },
    { text: 'Serve topped with grated parmesan.', minutes: null },
  ],
  tips: ['Save a mug of pasta water before draining — the starch makes the sauce cling.'],
};

export const FAULTS = [
  'flaky-json', // malformed on attempt 1, fine on attempt 2 → shows auto-recovery
  'malformed',
  'fenced-prose',
  'wrong-shape',
  'partial',
  'empty',
  'refusal',
  'truncated',
  'slow',
  'timeout',
  'rate-limit',
  'server-error',
];

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

/**
 * Returns `{ text, finishReason }` for faults that simulate model *output*,
 * throws an ApiError for faults that simulate *transport* failures, or returns
 * `null` to let the request proceed normally (after any delay).
 */
export async function applyFault(fault, { attempt, signal }) {
  const ok = (obj) => ({ text: JSON.stringify(obj), finishReason: 'STOP' });
  switch (fault) {
    case 'flaky-json':
      await sleep(800, signal);
      return attempt <= 1 ? { text: '{"title": "Pasta", "ingredients": [{"name": ', finishReason: 'STOP' } : ok(SAMPLE_RECIPE);
    case 'malformed':
      await sleep(800, signal);
      return { text: 'Sure! Here is a recipe: {title: Pasta, ingredients: [pasta, tomato', finishReason: 'STOP' };
    case 'fenced-prose':
      await sleep(800, signal);
      return { text: 'Here you go!\n```json\n' + JSON.stringify(SAMPLE_RECIPE, null, 2) + '\n```\nEnjoy!', finishReason: 'STOP' };
    case 'wrong-shape':
      await sleep(800, signal);
      return ok({ recipeName: 'Pasta', items: 'pasta, tomatoes, garlic', instructions: 'Cook it.' });
    case 'partial':
      await sleep(800, signal);
      return ok({
        ...SAMPLE_RECIPE,
        servings: '2 people',
        ingredients: [...SAMPLE_RECIPE.ingredients, { quantity: 3 }, 'a pinch of chilli flakes', { name: '', unit: 'g' }],
        steps: [...SAMPLE_RECIPE.steps.slice(0, 5), { minutes: 4 }, '6. Serve topped with grated parmesan.'],
      });
    case 'empty':
      await sleep(800, signal);
      return { text: '', finishReason: 'STOP' };
    case 'refusal':
      await sleep(800, signal);
      return ok({ refusal: "That doesn't look like a list of ingredients — try something like \"eggs, spinach, feta\".", title: '', servings: 0, ingredients: [], steps: [] });
    case 'truncated':
      await sleep(800, signal);
      return { text: JSON.stringify(SAMPLE_RECIPE).slice(0, 400), finishReason: 'MAX_TOKENS' };
    case 'slow':
      await sleep(12_000, signal);
      return null;
    case 'timeout':
      // Caller wires a short timeout for this fault, so this sleep gets aborted.
      await sleep(60_000, signal);
      return null;
    case 'rate-limit':
      await sleep(500, signal);
      throw new ApiError(429, 'RATE_LIMITED', 'Simulated 429 from the model provider', { retryable: true });
    case 'server-error':
      await sleep(500, signal);
      throw new ApiError(502, 'UPSTREAM_ERROR', 'Simulated 500 from the model provider', { retryable: true });
    default:
      return null;
  }
}
