// Turns untrusted model text into a recipe object the UI can rely on.
//
// Strategy: be lenient about *form* (code fences, prose around the JSON,
// numbers-as-strings, "1/2", strings instead of objects) and strict about
// *substance* (we must end up with a title, ≥1 ingredient and ≥1 step).
// Anything salvageable is kept; anything dropped is reported as a warning so
// the user knows the recipe may be incomplete.
import { AppError } from './errors.js';

const MAX_INGREDIENTS = 40;
const MAX_STEPS = 40;
const MAX_SWAPS = 4;
const MAX_TIPS = 5;

/**
 * @typedef {{ name: string, quantity: number|null, unit: string, note: string }} Swap
 * @typedef {{ id: string, name: string, quantity: number|null, unit: string, note: string, fromPantry: boolean, swaps: Swap[] }} Ingredient
 * @typedef {{ id: string, text: string, minutes: number|null }} Step
 * @typedef {{ title: string, description: string, servings: number, prepMinutes: number|null, cookMinutes: number|null, ingredients: Ingredient[], steps: Step[], tips: string[] }} Recipe
 *
 * @typedef {{ ok: true, recipe: Recipe, warnings: string[] }
 *         | { ok: false, refusal: string }} ParseResult
 */

/**
 * Full pipeline: raw text → JSON → validated Recipe.
 * Throws AppError(EMPTY | MALFORMED_JSON | TRUNCATED | INVALID_SHAPE).
 * @returns {ParseResult}
 */
export function parseRecipeResponse(text, finishReason = null) {
  let json;
  try {
    json = extractJson(text);
  } catch (err) {
    // A length cut-off almost always shows up as unparseable JSON; say so.
    if (finishReason === 'MAX_TOKENS' && err.code === 'MALFORMED_JSON') {
      throw new AppError('TRUNCATED', 'Model output hit the token limit', { retryable: true });
    }
    throw err;
  }
  return normalizeRecipe(json);
}

/** Pulls a JSON value out of model text that may include fences or prose. */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AppError('EMPTY', 'Model returned an empty response', { retryable: true });
  }
  let s = text.trim();

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    // Fall back to the outermost {...} in case of leading/trailing prose.
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AppError('MALFORMED_JSON', `Could not parse model output as JSON: ${preview(text)}`, { retryable: true });
  }
}

/**
 * Validates + coerces an arbitrary JSON value into a Recipe.
 * @returns {ParseResult}
 */
export function normalizeRecipe(value) {
  const warnings = [];
  let data = value;

  // Common wrappers: [ {...} ] or { recipe: {...} }
  if (Array.isArray(data) && isObject(data[0])) data = data[0];
  if (isObject(data) && isObject(data.recipe) && !data.ingredients) data = data.recipe;

  if (!isObject(data)) {
    throw shapeError(`Expected a JSON object, got ${Array.isArray(value) ? 'an array' : typeof value}`);
  }

  const refusal = cleanString(data.refusal);
  if (refusal) return { ok: false, refusal };

  // --- ingredients -------------------------------------------------------
  if (!Array.isArray(data.ingredients)) throw shapeError('"ingredients" is missing or not a list');
  const ingredients = [];
  let droppedIngredients = 0;
  for (const raw of data.ingredients) {
    const ing = normalizeIngredient(raw);
    if (ing && ingredients.length < MAX_INGREDIENTS) ingredients.push({ id: `ing-${ingredients.length}`, ...ing });
    else droppedIngredients++;
  }

  // --- steps -------------------------------------------------------------
  if (!Array.isArray(data.steps)) throw shapeError('"steps" is missing or not a list');
  const steps = [];
  let droppedSteps = 0;
  for (const raw of data.steps) {
    const step = normalizeStep(raw);
    if (step && steps.length < MAX_STEPS) steps.push({ id: `step-${steps.length}`, ...step });
    else droppedSteps++;
  }

  if (ingredients.length === 0) throw shapeError('No usable ingredients in the response');
  if (steps.length === 0) throw shapeError('No usable steps in the response');

  if (droppedIngredients) warnings.push(`${droppedIngredients} ingredient${plural(droppedIngredients)} couldn't be read and ${droppedIngredients === 1 ? 'was' : 'were'} left out.`);
  if (droppedSteps) warnings.push(`${droppedSteps} step${plural(droppedSteps)} couldn't be read and ${droppedSteps === 1 ? 'was' : 'were'} left out — double-check the method.`);

  // --- scalars -----------------------------------------------------------
  let title = cleanString(data.title);
  if (!title) {
    title = 'Untitled recipe';
    warnings.push('The recipe came back without a name.');
  }

  let servings = toPositiveInt(data.servings);
  if (servings == null || servings > 50) {
    servings = 2;
    warnings.push("The serving size was missing, so we assumed 2 — scaled amounts may be off.");
  }

  const tips = Array.isArray(data.tips) ? data.tips.map(cleanString).filter(Boolean).slice(0, MAX_TIPS) : [];

  return {
    ok: true,
    warnings,
    recipe: {
      title: title.slice(0, 120),
      description: cleanString(data.description).slice(0, 400),
      servings,
      prepMinutes: toMinutes(data.prepMinutes),
      cookMinutes: toMinutes(data.cookMinutes),
      ingredients,
      steps,
      tips,
    },
  };
}

function normalizeIngredient(raw) {
  if (typeof raw === 'string') {
    const name = cleanString(raw);
    return name ? { name, quantity: null, unit: '', note: '', fromPantry: true, swaps: [] } : null;
  }
  if (!isObject(raw)) return null;
  const name = cleanString(raw.name);
  if (!name) return null;

  const swaps = Array.isArray(raw.swaps)
    ? raw.swaps
        .map((s) => (typeof s === 'string' ? { name: s } : s))
        .filter((s) => isObject(s) && cleanString(s.name))
        .slice(0, MAX_SWAPS)
        .map((s) => ({ name: cleanString(s.name), quantity: toQuantity(s.quantity), unit: cleanString(s.unit), note: cleanString(s.note) }))
    : [];

  return {
    name,
    quantity: toQuantity(raw.quantity),
    unit: cleanString(raw.unit),
    note: cleanString(raw.note),
    // Default to "you have it": wrongly nagging the user to buy something is worse.
    fromPantry: raw.fromPantry === false || raw.fromPantry === 'false' ? false : true,
    swaps,
  };
}

function normalizeStep(raw) {
  const text = typeof raw === 'string' ? raw : isObject(raw) ? raw.text ?? raw.instruction : null;
  // Strip numbering the model may add even though we asked it not to ("3. ", "Step 3:").
  const clean = cleanString(text).replace(/^(step\s*)?\d+\s*[.):-]\s*/i, '');
  if (!clean) return null;
  return { text: clean, minutes: isObject(raw) ? toMinutes(raw.minutes) : null };
}

// --- coercion helpers ------------------------------------------------------

const UNICODE_FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

/** Accepts 2, "2", "1/2", "1 1/2", "½", "1½"; returns a positive number or null. */
export function toQuantity(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;

  let total = 0;
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (s.includes(ch)) {
      total += val;
      s = s.replace(ch, ' ').trim();
    }
  }
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (mixed) total += Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (frac) total += Number(frac[1]) / Number(frac[2]);
  else if (s) total += parseFloat(s);

  return Number.isFinite(total) && total > 0 ? total : null;
}

function toPositiveInt(v) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

function toMinutes(v) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 && n < 24 * 60 ? Math.round(n) : null;
}

function cleanString(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plural = (n) => (n === 1 ? '' : 's');
const preview = (s) => JSON.stringify(String(s).slice(0, 80)) + (String(s).length > 80 ? '…' : '');
const shapeError = (msg) => new AppError('INVALID_SHAPE', msg, { retryable: true });
