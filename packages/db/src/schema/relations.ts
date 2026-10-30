import { relations } from 'drizzle-orm';
import { accounts, sessions, twoFactors } from './auth';
import { payments, plans, subscriptions } from './billing';
import { episodeImages, episodes, series } from './content';
import { comments, follows, likes, readingProgress } from './engagement';
import { creatorProfiles, users } from './users';

// For Drizzle's relational query API (db.query.*). They add no database constraints.

export const usersRelations = relations(users, ({ one, many }) => ({
  creatorProfile: one(creatorProfiles),
  series: many(series),
  follows: many(follows),
  likes: many(likes),
  comments: many(comments),
  readingProgress: many(readingProgress),
  subscriptions: many(subscriptions),
  payments: many(payments),
  sessions: many(sessions),
  accounts: many(accounts),
  twoFactors: many(twoFactors),
}));

export const creatorProfilesRelations = relations(creatorProfiles, ({ one }) => ({
  user: one(users, { fields: [creatorProfiles.userId], references: [users.id] }),
}));

export const seriesRelations = relations(series, ({ one, many }) => ({
  creator: one(users, { fields: [series.creatorId], references: [users.id] }),
  episodes: many(episodes),
  follows: many(follows),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  series: one(series, { fields: [episodes.seriesId], references: [series.id] }),
  images: many(episodeImages),
  likes: many(likes),
  comments: many(comments),
}));

export const episodeImagesRelations = relations(episodeImages, ({ one }) => ({
  episode: one(episodes, { fields: [episodeImages.episodeId], references: [episodes.id] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  user: one(users, { fields: [follows.userId], references: [users.id] }),
  series: one(series, { fields: [follows.seriesId], references: [series.id] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  episode: one(episodes, { fields: [likes.episodeId], references: [episodes.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  episode: one(episodes, { fields: [comments.episodeId], references: [episodes.id] }),
}));

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  user: one(users, { fields: [readingProgress.userId], references: [users.id] }),
  series: one(series, { fields: [readingProgress.seriesId], references: [series.id] }),
  episode: one(episodes, { fields: [readingProgress.episodeId], references: [episodes.id] }),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  subscription: one(subscriptions, {
    fields: [payments.subscriptionId],
    references: [subscriptions.id],
  }),
}));
