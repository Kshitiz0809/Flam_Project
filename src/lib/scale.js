// Quantity scaling + human-friendly formatting ("1 ½ cup", "350 g").

export function scaleQuantity(quantity, baseServings, targetServings) {
  if (quantity == null || !baseServings) return quantity ?? null;
  return (quantity * targetServings) / baseServings;
}

const METRIC = new Set(['g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters']);
const METRIC_LARGE = new Set(['kg', 'l', 'litre', 'liter', 'litres', 'liters']);

const FRACTIONS = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [1, ''],
];

/** Formats a number for display given its unit. Returns '' for null. */
export function formatQuantity(q, unit = '') {
  if (q == null || !Number.isFinite(q) || q <= 0) return '';
  const u = unit.toLowerCase();

  if (METRIC.has(u)) {
    // 437.5 g → 440 g; 12.5 g → 13 g
    return String(q >= 100 ? Math.round(q / 10) * 10 : q >= 20 ? Math.round(q / 5) * 5 : Math.max(1, Math.round(q)));
  }
  if (METRIC_LARGE.has(u)) {
    return String(Math.round(q * 10) / 10);
  }
  if (q >= 10) return String(Math.round(q));

  // Cups, spoons, cloves, counts → nearest kitchen fraction.
  let whole = Math.floor(q);
  const rest = q - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  if (best[0] === 1) {
    whole += 1;
    best = FRACTIONS[0];
  }
  if (whole === 0 && !best[1]) return '⅛'; // never show "0"
  return [whole || '', best[1]].filter(Boolean).join(' ');
}

/** "1 ½ cup", "200 g", "" (to taste). */
export function formatAmount(quantity, unit) {
  const q = formatQuantity(quantity, unit);
  if (!q) return '';
  return unit ? `${q} ${unit}` : q;
}
