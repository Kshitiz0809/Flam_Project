// A "session" is one recipe the user is working on: the request that produced
// it, every version produced by refinements (for undo), and the user's
// interactive progress (checked steps, servings, swaps). It is plain JSON so it
// can be saved to localStorage as-is.

/**
 * @typedef {{ ingredients: string, servings: number, diet: string[] }} RecipeRequest
 * @typedef {{ recipe: import('./parseRecipe.js').Recipe, warnings: string[], instruction: string|null }} Version
 * @typedef {{ servings: number, doneSteps: Record<string, true>, gathered: Record<string, true>, swaps: Record<string, number> }} Progress
 * @typedef {{ id: string, createdAt: number, updatedAt: number, request: RecipeRequest, versions: Version[], progress: Progress }} Session
 */

const freshProgress = (servings) => ({ servings, doneSteps: {}, gathered: {}, swaps: {} });

export function createSession(request, { recipe, warnings }) {
  const now = Date.now();
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(now),
    createdAt: now,
    updatedAt: now,
    request,
    versions: [{ recipe, warnings, instruction: null }],
    // Show the recipe at the size the user asked for, even if the model
    // ignored the request and wrote it for a different number of people.
    progress: freshProgress(request.servings || recipe.servings),
  };
}

export const currentVersion = (session) => session.versions[session.versions.length - 1];

/** @returns {Session|null} */
export function sessionReducer(session, action) {
  if (action.type === 'load') return action.session;
  if (action.type === 'clear') return null;
  if (!session) return session;

  const touch = (next) => ({ ...next, updatedAt: Date.now() });
  const progress = session.progress;

  switch (action.type) {
    case 'refined':
      // Ids are positional, so old checkmarks/swaps would point at the wrong
      // items in the new version. Keep only the servings choice.
      return touch({
        ...session,
        versions: [...session.versions, { recipe: action.recipe, warnings: action.warnings, instruction: action.instruction }],
        progress: freshProgress(progress.servings),
      });
    case 'undo':
      if (session.versions.length < 2) return session;
      return touch({ ...session, versions: session.versions.slice(0, -1), progress: freshProgress(progress.servings) });
    case 'toggleStep':
      return touch({ ...session, progress: { ...progress, doneSteps: toggle(progress.doneSteps, action.id) } });
    case 'toggleGathered':
      return touch({ ...session, progress: { ...progress, gathered: toggle(progress.gathered, action.id) } });
    case 'setServings':
      return touch({ ...session, progress: { ...progress, servings: clamp(action.servings, 1, 24) } });
    case 'chooseSwap': {
      const swaps = { ...progress.swaps };
      if (action.index == null) delete swaps[action.id];
      else swaps[action.id] = action.index;
      return touch({ ...session, progress: { ...progress, swaps } });
    }
    case 'resetProgress':
      return touch({ ...session, progress: freshProgress(progress.servings) });
    default:
      return session;
  }
}

function toggle(map, id) {
  const next = { ...map };
  if (next[id]) delete next[id];
  else next[id] = true;
  return next;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));
