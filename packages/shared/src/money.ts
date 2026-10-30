import { z } from 'zod';

/** Money is always integer minor units (cents) plus an ISO 4217 currency code. Never floats. */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof moneySchema>;

/** Formats minor units for display, e.g. { 499, 'USD' } -> "$4.99". */
export function formatMoney(money: Money, locale = 'en-US'): string {
  const { amountMinor, currency } = moneySchema.parse(money);
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** digits);
}
