// Saved sessions in localStorage. Everything read back is treated as untrusted
// (it may be from an older version of the app, hand-edited, or corrupted), so
// recipes go back through the same validator used for model output.
import { normalizeRecipe } from './parseRecipe.js';

const KEY = 'fridge-to-fork:sessions:v1';
const MAX_SESSIONS = 20;

export function loadSessions() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(reviveSession).filter(Boolean);
}

export function saveSessions(sessions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    return true;
  } catch {
    return false; // quota exceeded / storage disabled — the app still works
  }
}

/** Inserts or replaces `session`, most recently updated first. */
export function upsertSession(sessions, session) {
  return [session, ...sessions.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
}

function reviveSession(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !Array.isArray(s.versions)) return null;
  const versions = [];
  for (const v of s.versions) {
    try {
      const res = normalizeRecipe(v?.recipe);
      if (res.ok) versions.push({ recipe: res.recipe, warnings: Array.isArray(v.warnings) ? v.warnings : [], instruction: typeof v.instruction === 'string' ? v.instruction : null });
    } catch {
      /* drop unreadable version */
    }
  }
  if (!versions.length) return null;
  const req = s.request || {};
  const p = s.progress || {};
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  return {
    id: s.id,
    createdAt: Number(s.createdAt) || Date.now(),
    updatedAt: Number(s.updatedAt) || Date.now(),
    request: {
      ingredients: typeof req.ingredients === 'string' ? req.ingredients : '',
      servings: Number(req.servings) || versions[0].recipe.servings,
      diet: Array.isArray(req.diet) ? req.diet.filter((d) => typeof d === 'string') : [],
    },
    versions,
    progress: {
      servings: Number(p.servings) || versions.at(-1).recipe.servings,
      doneSteps: obj(p.doneSteps),
      gathered: obj(p.gathered),
      swaps: obj(p.swaps),
    },
  };
}
