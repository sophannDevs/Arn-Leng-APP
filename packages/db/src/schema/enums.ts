import {
  AGE_RATINGS,
  COMMENT_STATUSES,
  EPISODE_ACCESS_TYPES,
  EPISODE_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PLAN_INTERVALS,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  SERIES_STATUSES,
  SUBSCRIPTION_STATUSES,
  UPLOAD_STATUSES,
  USER_ROLES,
} from '@inkline/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

// Values come from @inkline/shared so app code and the database agree.
export const userRole = pgEnum('user_role', USER_ROLES);
export const seriesStatus = pgEnum('series_status', SERIES_STATUSES);
export const ageRating = pgEnum('age_rating', AGE_RATINGS);
export const episodeStatus = pgEnum('episode_status', EPISODE_STATUSES);
export const episodeAccessType = pgEnum('episode_access_type', EPISODE_ACCESS_TYPES);
export const commentStatus = pgEnum('comment_status', COMMENT_STATUSES);
export const reportTargetType = pgEnum('report_target_type', REPORT_TARGET_TYPES);
export const reportStatus = pgEnum('report_status', REPORT_STATUSES);
export const planInterval = pgEnum('plan_interval', PLAN_INTERVALS);
export const subscriptionStatus = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const paymentProvider = pgEnum('payment_provider', PAYMENT_PROVIDERS);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const uploadStatus = pgEnum('upload_status', UPLOAD_STATUSES);
