// @vitest-environment jsdom
// End-to-end-ish: render the whole app with a mocked /api and click through it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';

const RECIPE = {
  refusal: null,
  title: 'Spinach Omelette',
  description: 'Quick and green.',
  servings: 2,
  prepMinutes: 5,
  cookMinutes: 5,
  ingredients: [
    { name: 'eggs', quantity: 4, unit: '', fromPantry: true, swaps: [] },
    { name: 'milk', quantity: 0.5, unit: 'cup', fromPantry: true, swaps: [{ name: 'oat milk', quantity: 0.5, unit: 'cup', note: 'dairy-free' }] },
    { name: 'feta', quantity: 50, unit: 'g', fromPantry: false, swaps: [] },
  ],
  steps: [{ text: 'Whisk the eggs and milk.', minutes: 1 }, { text: 'Cook in a hot pan.', minutes: 4 }],
  tips: ['Low heat keeps it soft.'],
};

let recipeResponses;

beforeEach(() => {
  localStorage.clear();
  recipeResponses = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url === '/api/health') return new Response(JSON.stringify({ ok: true, model: 'test-model', keyConfigured: true, faults: [] }));
      const next = recipeResponses.shift() ?? { text: JSON.stringify(RECIPE), finishReason: 'STOP' };
      return new Response(JSON.stringify(next), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function generate(ingredients = 'eggs, milk, spinach') {
  fireEvent.change(screen.getByLabelText(/what's in your fridge/i), { target: { value: ingredients } });
  fireEvent.click(screen.getByRole('button', { name: /get a recipe/i }));
  return screen.findByRole('heading', { name: RECIPE.title });
}

describe('App', () => {
  it('shows the empty state first and disables submit until there is input', () => {
    render(<App />);
    expect(screen.getByText(/nothing cooking yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /get a recipe/i }).disabled).toBe(true);
  });

  it('renders an interactive recipe: scaling, swaps, step progress, shopping list', async () => {
    render(<App />);
    await generate();

    expect(screen.getByText(/you'll also need/i).closest('.callout').textContent).toMatch(/feta/);
    const ingredients = screen.getByRole('heading', { name: 'Ingredients' }).closest('section');
    expect(within(ingredients).getByText('½ cup')).toBeTruthy();

    // Scale 2 → 3 servings
    fireEvent.click(screen.getByRole('button', { name: /more servings/i }));
    expect(within(ingredients).getByText('6')).toBeTruthy(); // 4 eggs × 1.5
    expect(within(ingredients).getByText('¾ cup')).toBeTruthy();

    // Swap milk → oat milk
    fireEvent.change(screen.getByLabelText(/swap milk/i), { target: { value: '0' } });
    expect(within(ingredients).getByText('oat milk')).toBeTruthy();
    expect(screen.getByText(/method still mentions/i)).toBeTruthy();

    // Check off a step
    fireEvent.click(screen.getByRole('checkbox', { name: /whisk the eggs/i }));
    expect(screen.getByText(/1\/2 done/)).toBeTruthy();
  });

  it('autosaves the session to localStorage', async () => {
    render(<App />);
    await generate();
    await waitFor(() => expect(localStorage.getItem('fridge-to-fork:sessions:v1')).toMatch(/Spinach Omelette/));
  });

  it('shows a retryable error for unusable output, and recovers on retry', async () => {
    recipeResponses = [
      { text: '{"nope": true}', finishReason: 'STOP' },
      { text: '{"nope": true}', finishReason: 'STOP' }, // auto-retry also bad
    ];
    render(<App />);
    fireEvent.change(screen.getByLabelText(/what's in your fridge/i), { target: { value: 'eggs' } });
    fireEvent.click(screen.getByRole('button', { name: /get a recipe/i }));

    expect(await screen.findByText(/wasn't a usable recipe/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: RECIPE.title })).toBeTruthy();
  });

  it('shows the model refusal as an empty state', async () => {
    recipeResponses = [{ text: JSON.stringify({ refusal: 'That is a shoe.', ingredients: [], steps: [] }), finishReason: 'STOP' }];
    render(<App />);
    fireEvent.change(screen.getByLabelText(/what's in your fridge/i), { target: { value: 'a shoe' } });
    fireEvent.click(screen.getByRole('button', { name: /get a recipe/i }));
    expect(await screen.findByText('That is a shoe.')).toBeTruthy();
  });

  it('keeps the current recipe when a refinement fails, and applies a good one with undo', async () => {
    render(<App />);
    await generate();

    recipeResponses = [{ text: '', finishReason: 'STOP' }, { text: '', finishReason: 'STOP' }];
    fireEvent.click(screen.getByRole('button', { name: 'Make it spicier' }));
    expect(await screen.findByText(/your recipe is unchanged/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: RECIPE.title })).toBeTruthy();

    recipeResponses = [{ text: JSON.stringify({ ...RECIPE, title: 'Spicy Spinach Omelette' }), finishReason: 'STOP' }];
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Spicy Spinach Omelette' })).toBeTruthy();
    expect(screen.getByText(/version 2/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /undo change/i }));
    expect(screen.getByRole('heading', { name: RECIPE.title })).toBeTruthy();
  });
});
