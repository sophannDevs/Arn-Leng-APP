import { z } from 'zod';
import { PLAN_PRICES } from './constants';

/** Plan codes as stored in plans.code (see PLAN_PRICES). */
export const PLAN_CODES = Object.keys(PLAN_PRICES) as [
  keyof typeof PLAN_PRICES,
  ...Array<keyof typeof PLAN_PRICES>,
];
export type PlanCode = (typeof PLAN_CODES)[number];
export const planCodeSchema = z.enum(PLAN_CODES);

/** Redis key holding a user's subscriptions for access checks (cleared whenever they change). */
export const entitlementKey = (userId: string) => `entitlement:${userId}`;

/**
 * Where "Continue reading" may send someone after paying: only a path inside the site, and only
 * the home page or an episode page. Anything else (another site, a script) falls back to null.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  return value === '/' || /^\/series\/[a-z0-9-]+(\/\d{1,5})?$/.test(value) ? value : null;
}

export const checkoutInputSchema = z.object({
  planCode: planCodeSchema,
  returnTo: z.string().optional(),
});

export const switchPlanInputSchema = z.object({
  /** The plan to move to at the next renewal, or null to stay on the current plan. */
  planCode: planCodeSchema.nullable(),
});

export const COMPLIMENTARY_MONTHS = [1, 3, 6, 12] as const;
export const grantComplimentarySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  months: z.coerce
    .number()
    .int()
    .refine((m) => (COMPLIMENTARY_MONTHS as readonly number[]).includes(m)),
  note: z.string().trim().max(200).optional(),
});

export const FAKE_PAY_OUTCOMES = ['success', 'failure', 'delayed_success'] as const;
export const fakePayInputSchema = z.object({ outcome: z.enum(FAKE_PAY_OUTCOMES) });
export const FAKE_CALLBACK_DELAY_MS = 4000;
