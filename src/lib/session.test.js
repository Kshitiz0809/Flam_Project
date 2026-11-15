import { describe, expect, it } from 'vitest';
import { createSession, currentVersion, sessionReducer } from './session.js';
import { normalizeRecipe } from './parseRecipe.js';

const recipe = (title) =>
  normalizeRecipe({ title, servings: 2, ingredients: [{ name: 'a', swaps: [{ name: 'b' }] }], steps: ['one', 'two'] }).recipe;

const base = () => createSession({ ingredients: 'a', servings: 4, diet: [] }, { recipe: recipe('v1'), warnings: [] });

describe('sessionReducer', () => {
  it('starts at the servings the user asked for', () => {
    expect(base().progress.servings).toBe(4);
  });

  it('tracks progress and swaps', () => {
    let s = base();
    s = sessionReducer(s, { type: 'toggleStep', id: 'step-0' });
    s = sessionReducer(s, { type: 'chooseSwap', id: 'ing-0', index: 0 });
    expect(s.progress.doneSteps).toEqual({ 'step-0': true });
    expect(s.progress.swaps).toEqual({ 'ing-0': 0 });
    s = sessionReducer(s, { type: 'toggleStep', id: 'step-0' });
    s = sessionReducer(s, { type: 'chooseSwap', id: 'ing-0', index: null });
    expect(s.progress.doneSteps).toEqual({});
    expect(s.progress.swaps).toEqual({});
  });

  it('refine pushes a version, keeps servings, resets checkmarks; undo restores', () => {
    let s = base();
    s = sessionReducer(s, { type: 'setServings', servings: 6 });
    s = sessionReducer(s, { type: 'toggleStep', id: 'step-1' });
    s = sessionReducer(s, { type: 'refined', recipe: recipe('v2'), warnings: [], instruction: 'spicier' });
    expect(currentVersion(s).recipe.title).toBe('v2');
    expect(s.progress).toMatchObject({ servings: 6, doneSteps: {} });
    s = sessionReducer(s, { type: 'undo' });
    expect(currentVersion(s).recipe.title).toBe('v1');
    expect(sessionReducer(s, { type: 'undo' })).toBe(s); // can't undo past v1
  });

  it('clamps servings', () => {
    expect(sessionReducer(base(), { type: 'setServings', servings: 0 }).progress.servings).toBe(1);
    expect(sessionReducer(base(), { type: 'setServings', servings: 99 }).progress.servings).toBe(24);
  });
});
