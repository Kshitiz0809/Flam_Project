import { describe, expect, it } from 'vitest';
import { itemsToText, normalizeScan, parseScanResponse } from './parseScan.js';

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

describe('parseScanResponse', () => {
  it('parses a valid scan', () => {
    const res = parseScanResponse(JSON.stringify({ refusal: null, ingredients: [{ name: 'eggs', amount: '6', confidence: 'high' }] }));
    expect(res).toEqual({ ok: true, warnings: [], items: [{ id: 'scan-0', name: 'eggs', amount: '6', confidence: 'high' }] });
  });

  it('maps bad output to typed errors', () => {
    expect(codeOf(() => parseScanResponse(''))).toBe('EMPTY');
    expect(codeOf(() => parseScanResponse('{"ingredients": [{"name": "eg'))).toBe('MALFORMED_JSON');
    expect(codeOf(() => parseScanResponse('{"ingredients": [{"name": "eg', 'MAX_TOKENS'))).toBe('TRUNCATED');
    expect(codeOf(() => parseScanResponse('{"food": "eggs"}'))).toBe('INVALID_SHAPE');
  });

  it('returns refusals', () => {
    expect(parseScanResponse('{"refusal": "That is a cat.", "ingredients": []}')).toEqual({ ok: false, refusal: 'That is a cat.' });
  });

  it('treats an empty list as a valid "nothing found" answer', () => {
    expect(parseScanResponse('{"refusal": null, "ingredients": []}')).toMatchObject({ ok: true, items: [] });
  });
});

describe('normalizeScan', () => {
  it('salvages messy items: strings, duplicates, bad confidence, missing names', () => {
    const res = normalizeScan({
      ingredients: ['lemons', { name: 'Eggs', confidence: 'high' }, { name: 'eggs', confidence: 'low' }, { amount: '2' }, { name: 'butter', confidence: 'very sure', amount: 1 }],
    });
    expect(res.items.map((i) => [i.name, i.confidence, i.amount])).toEqual([
      ['lemons', 'medium', ''],
      ['Eggs', 'high', ''],
      ['butter', 'medium', '1'],
    ]);
    expect(res.warnings).toHaveLength(1);
  });

  it('accepts a bare array', () => {
    expect(normalizeScan(['milk']).items[0].name).toBe('milk');
  });
});

describe('itemsToText', () => {
  it('formats items and skips ones already in the text box', () => {
    const items = [
      { name: 'eggs', amount: '6' },
      { name: 'Milk', amount: '' },
      { name: 'spinach', amount: '1 bag' },
    ];
    expect(itemsToText(items, 'some milk, rice')).toBe('eggs (6), spinach (1 bag)');
  });
});
