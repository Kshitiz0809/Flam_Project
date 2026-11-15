import { describe, expect, it } from 'vitest';
import { extractJson, normalizeRecipe, parseRecipeResponse, toQuantity } from './parseRecipe.js';

const valid = {
  refusal: null,
  title: 'Shakshuka',
  description: 'Eggs in spicy tomato sauce.',
  servings: 2,
  prepMinutes: 5,
  cookMinutes: 20,
  ingredients: [
    { name: 'eggs', quantity: 4, unit: '', fromPantry: true, swaps: [] },
    { name: 'canned tomatoes', quantity: 400, unit: 'g', fromPantry: true, swaps: [{ name: 'fresh tomatoes', quantity: 500, unit: 'g' }] },
  ],
  steps: [{ text: 'Simmer the tomatoes.', minutes: 10 }, { text: 'Crack in the eggs and cover.', minutes: 6 }],
  tips: [],
};

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips markdown fences and surrounding prose', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nEnjoy')).toEqual({ a: 1 });
  });
  it('finds the outermost object inside prose', () => {
    expect(extractJson('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });
  it('rejects empty output', () => {
    expect(codeOf(() => extractJson('   '))).toBe('EMPTY');
    expect(codeOf(() => extractJson(undefined))).toBe('EMPTY');
  });
  it('rejects malformed JSON', () => {
    expect(codeOf(() => extractJson('{title: Pasta, ingredients: [pasta'))).toBe('MALFORMED_JSON');
  });
});

describe('parseRecipeResponse', () => {
  it('reports truncation when the model hit the token limit', () => {
    const cut = JSON.stringify(valid).slice(0, 60);
    expect(codeOf(() => parseRecipeResponse(cut, 'MAX_TOKENS'))).toBe('TRUNCATED');
    expect(codeOf(() => parseRecipeResponse(cut, 'STOP'))).toBe('MALFORMED_JSON');
  });
});

describe('normalizeRecipe', () => {
  it('accepts a valid recipe with no warnings and assigns ids', () => {
    const res = normalizeRecipe(valid);
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.recipe.ingredients.map((i) => i.id)).toEqual(['ing-0', 'ing-1']);
    expect(res.recipe.steps[1]).toEqual({ id: 'step-1', text: 'Crack in the eggs and cover.', minutes: 6 });
  });

  it('returns a refusal instead of a recipe', () => {
    expect(normalizeRecipe({ refusal: 'Not food', ingredients: [], steps: [] })).toEqual({ ok: false, refusal: 'Not food' });
  });

  it('unwraps { recipe: {...} } and [ {...} ]', () => {
    expect(normalizeRecipe({ recipe: valid }).ok).toBe(true);
    expect(normalizeRecipe([valid]).ok).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(codeOf(() => normalizeRecipe({ recipeName: 'x', items: 'a, b' }))).toBe('INVALID_SHAPE');
    expect(codeOf(() => normalizeRecipe('a string'))).toBe('INVALID_SHAPE');
    expect(codeOf(() => normalizeRecipe(null))).toBe('INVALID_SHAPE');
    expect(codeOf(() => normalizeRecipe({ ...valid, steps: [] }))).toBe('INVALID_SHAPE');
    expect(codeOf(() => normalizeRecipe({ ...valid, ingredients: [{ quantity: 2 }] }))).toBe('INVALID_SHAPE');
  });

  it('salvages partially broken data and warns', () => {
    const res = normalizeRecipe({
      ...valid,
      servings: '4 people',
      ingredients: [...valid.ingredients, { quantity: 3 }, 'chilli flakes', { name: '  ' }],
      steps: [...valid.steps, { minutes: 3 }, '3. Serve with bread.'],
    });
    expect(res.ok).toBe(true);
    expect(res.recipe.servings).toBe(4);
    expect(res.recipe.ingredients.map((i) => i.name)).toEqual(['eggs', 'canned tomatoes', 'chilli flakes']);
    expect(res.recipe.steps.at(-1).text).toBe('Serve with bread.');
    expect(res.warnings).toHaveLength(2);
  });

  it('defaults missing title and servings with warnings', () => {
    const res = normalizeRecipe({ ...valid, title: '', servings: null });
    expect(res.recipe.title).toBe('Untitled recipe');
    expect(res.recipe.servings).toBe(2);
    expect(res.warnings).toHaveLength(2);
  });

  it('coerces fromPantry and treats unknown as "have it"', () => {
    const res = normalizeRecipe({ ...valid, ingredients: [{ name: 'a', fromPantry: 'false' }, { name: 'b' }] });
    expect(res.recipe.ingredients.map((i) => i.fromPantry)).toEqual([false, true]);
  });

  it('ignores junk in optional fields', () => {
    const res = normalizeRecipe({ ...valid, tips: 'not an array', prepMinutes: -5, cookMinutes: 'soon' });
    expect(res.recipe.tips).toEqual([]);
    expect(res.recipe.prepMinutes).toBeNull();
    expect(res.recipe.cookMinutes).toBeNull();
  });
});

describe('toQuantity', () => {
  it.each([
    [2, 2],
    ['2', 2],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['2 cups', 2],
    [0, null],
    [-1, null],
    ['to taste', null],
    [null, null],
    [NaN, null],
  ])('%j → %j', (input, expected) => {
    expect(toQuantity(input)).toBe(expected);
  });
});
