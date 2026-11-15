// Turns untrusted model text from /api/scan into a clean list of detected
// ingredients. Same philosophy as parseRecipe.js: lenient on form, strict on
// substance, and report what was dropped.
import { AppError } from './errors.js';
import { extractJson } from './parseRecipe.js';

const MAX_ITEMS = 40;
const CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * @typedef {{ id: string, name: string, amount: string, confidence: 'high'|'medium'|'low' }} DetectedItem
 * @returns {{ ok: true, items: DetectedItem[], warnings: string[] } | { ok: false, refusal: string }}
 */
export function parseScanResponse(text, finishReason = null) {
  let data;
  try {
    data = extractJson(text);
  } catch (err) {
    if (finishReason === 'MAX_TOKENS' && err.code === 'MALFORMED_JSON') {
      throw new AppError('TRUNCATED', 'Model output hit the token limit', { retryable: true });
    }
    throw err;
  }
  return normalizeScan(data);
}

export function normalizeScan(value) {
  let data = value;
  if (Array.isArray(data)) data = { ingredients: data }; // bare list is fine
  if (!data || typeof data !== 'object') throw shapeError('Expected a JSON object');

  const refusal = typeof data.refusal === 'string' ? data.refusal.trim() : '';
  if (refusal) return { ok: false, refusal };

  const list = data.ingredients ?? data.items;
  if (!Array.isArray(list)) throw shapeError('"ingredients" is missing or not a list');

  const items = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of list) {
    const obj = typeof raw === 'string' ? { name: raw } : raw;
    const name = typeof obj?.name === 'string' ? obj.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) {
      dropped++;
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key) || items.length >= MAX_ITEMS) continue; // duplicates aren't an error
    seen.add(key);
    const confidence = CONFIDENCE.has(obj.confidence) ? obj.confidence : 'medium';
    const amount = typeof obj.amount === 'string' || typeof obj.amount === 'number' ? String(obj.amount).trim() : '';
    items.push({ id: `scan-${items.length}`, name: name.slice(0, 60), amount: amount.slice(0, 40), confidence });
  }

  const warnings = dropped ? [`${dropped} item${dropped === 1 ? '' : 's'} couldn't be read and ${dropped === 1 ? 'was' : 'were'} skipped.`] : [];
  // An empty list is a valid answer ("I see no food"), not an error — the UI
  // shows a dedicated message for it.
  return { ok: true, items, warnings };
}

/** Text to append to the ingredient box, skipping things already listed there. */
export function itemsToText(items, existingText = '') {
  const existing = existingText.toLowerCase();
  return items
    .filter((i) => !existing.includes(i.name.toLowerCase()))
    .map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name))
    .join(', ');
}

const shapeError = (msg) => new AppError('INVALID_SHAPE', msg, { retryable: true });
