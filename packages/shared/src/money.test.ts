import { describe, expect, it } from 'vitest';
import { PLAN_PRICES } from './constants';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats the plan prices from minor units', () => {
    expect(formatMoney({ amountMinor: PLAN_PRICES.monthly.priceMinor, currency: 'USD' })).toBe(
      '$4.99',
    );
    expect(formatMoney({ amountMinor: PLAN_PRICES.yearly.priceMinor, currency: 'USD' })).toBe(
      '$49.99',
    );
  });

  it('respects currencies without minor units', () => {
    expect(formatMoney({ amountMinor: 4000, currency: 'JPY' })).toBe('¥4,000');
  });

  it('rejects fractional minor units', () => {
    expect(() => formatMoney({ amountMinor: 4.99, currency: 'USD' })).toThrow();
  });
});
