import { describe, expect, it } from 'vitest';
import { formatAmount, formatQuantity, scaleQuantity } from './scale.js';

describe('scaleQuantity', () => {
  it('scales linearly', () => {
    expect(scaleQuantity(200, 2, 4)).toBe(400);
    expect(scaleQuantity(3, 4, 2)).toBe(1.5);
  });
  it('keeps "to taste" (null) as null', () => {
    expect(scaleQuantity(null, 2, 4)).toBeNull();
  });
});

describe('formatQuantity', () => {
  it.each([
    [1.5, 'cup', '1 ½'],
    [0.25, 'tsp', '¼'],
    [0.33, 'cup', '⅓'],
    [0.98, 'cup', '1'],
    [0.01, 'tsp', '⅛'],
    [3, '', '3'],
    [437.5, 'g', '440'],
    [12.4, 'g', '12'],
    [1.25, 'kg', '1.3'],
    [12.3, 'clove', '12'],
    [null, 'g', ''],
  ])('%j %s → %j', (q, unit, expected) => {
    expect(formatQuantity(q, unit)).toBe(expected);
  });
});

describe('formatAmount', () => {
  it('joins quantity and unit', () => {
    expect(formatAmount(2, 'tbsp')).toBe('2 tbsp');
    expect(formatAmount(3, '')).toBe('3');
    expect(formatAmount(null, 'g')).toBe('');
  });
});
