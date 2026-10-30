import '../load-env';
import {
  CURRENCY,
  PLAN_PRICES,
  type SeriesStatus,
  type UserRole,
  defaultEpisodeAccess,
} from '@inkline/shared';
import { hashPassword } from 'better-auth/crypto';
import { getTableName, sql } from 'drizzle-orm';
import { createDb } from '../client';
import { directUrl, parseDbEnv } from '../env';
import * as s from '../schema';

/**
 * Development seed: replaces ALL data with a small known data set. Refuses to run in production,
 * and against a non-local database (e.g. Supabase) unless run with --allow-remote.
 * Dates are relative to now, so early access windows are always "live" after a fresh seed.
 * Emails use the reserved .test domain. Every seeded user has a verified email and signs in with
 * DEV_PASSWORD (development only; the admin is asked to set up 2FA on first sign-in).
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production. The seed deletes all data.');
  process.exit(1);
}

/** Password of every seeded user. Development data only. */
const DEV_PASSWORD = 'inkline-dev-password';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);

type SeedUser = { email: string; name: string; role: UserRole };
const seedUsers: SeedUser[] = [
  { email: 'admin@inkline.test', name: 'Ada Admin', role: 'admin' },
  { email: 'mina@inkline.test', name: 'Mina Park', role: 'creator' },
  { email: 'leo@inkline.test', name: 'Leo Santos', role: 'creator' },
  ...[1, 2, 3, 4, 5].map((n) => ({
    email: `reader${n}@inkline.test`,
    name: `Reader ${n}`,
    role: 'reader' as const,
  })),
];

const creatorProfiles: Record<string, { penName: string; bio: string }> = {
  'mina@inkline.test': { penName: 'MINA', bio: 'Fantasy and slice-of-life, one panel at a time.' },
  'leo@inkline.test': { penName: 'Leo S.', bio: 'Action, sci-fi and the occasional heist.' },
};

type SeedSeries = {
  creator: string;
  slug: string;
  title: string;
  description: string;
  genres: string[];
  status: SeriesStatus;
};
const seedSeries: SeedSeries[] = [
  {
    creator: 'mina@inkline.test',
    slug: 'moonlit-bakery',
    title: 'Moonlit Bakery',
    description: 'A night-shift baker serves pastries to spirits who pay in memories.',
    genres: ['fantasy', 'slice-of-life'],
    status: 'ongoing',
  },
  {
    creator: 'mina@inkline.test',
    slug: 'paper-crowns',
    title: 'Paper Crowns',
    description: 'Twin sisters trade places in a kingdom where every promise is binding.',
    genres: ['fantasy', 'drama'],
    status: 'ongoing',
  },
  {
    creator: 'mina@inkline.test',
    slug: 'after-school-tides',
    title: 'After-School Tides',
    description: 'A seaside swim club with four members and one very stubborn coach.',
    genres: ['sports', 'comedy'],
    status: 'completed',
  },
  {
    creator: 'leo@inkline.test',
    slug: 'neon-courier',
    title: 'Neon Courier',
    description: 'In a city that never powers down, one courier delivers what nobody else will.',
    genres: ['sci-fi', 'action'],
    status: 'ongoing',
  },
  {
    creator: 'leo@inkline.test',
    slug: 'the-last-heist',
    title: 'The Last Heist',
    description: 'Retired thieves reunite for one job: stealing back their own past.',
    genres: ['action', 'thriller'],
    status: 'ongoing',
  },
  {
    creator: 'leo@inkline.test',
    slug: 'iron-orchard',
    title: 'Iron Orchard',
    description: 'A farmer finds a sleeping war machine under her apple trees.',
    genres: ['sci-fi', 'drama'],
    status: 'hiatus',
  },
];

const EPISODES_PER_SERIES = 10;

const url = directUrl(parseDbEnv(process.env));
const host = new URL(url).hostname;
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
if (!isLocal && !process.argv.includes('--allow-remote')) {
  console.error(
    `Refusing to seed ${host}: the seed deletes all data. ` +
      'If this is a development database, run `pnpm db:seed --allow-remote`.',
  );
  process.exit(1);
}

const { db, close } = createDb(url, { max: 1 });

// Children before parents is not needed with CASCADE, but listing every table keeps the reset complete.
const allTables = [
  s.auditLogs,
  s.twoFactors,
  s.verifications,
  s.accounts,
  s.sessions,
  s.webhookEvents,
  s.payments,
  s.subscriptions,
  s.plans,
  s.episodeViewsDaily,
  s.readingProgress,
  s.reports,
  s.comments,
  s.likes,
  s.follows,
  s.episodeImages,
  s.episodes,
  s.series,
  s.creatorProfiles,
  s.users,
];

try {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`truncate table ${sql.join(
        allTables.map((t) => sql.identifier(getTableName(t))),
        sql`, `,
      )} cascade`,
    );

    const users = await tx
      .insert(s.users)
      .values(seedUsers.map((u) => ({ ...u, emailVerified: true })))
      .returning({ id: s.users.id, email: s.users.email });
    const userId = (email: string) => {
      const user = users.find((u) => u.email === email);
      if (!user) throw new Error(`Seed user ${email} missing`);
      return user.id;
    };

    const passwordHash = await hashPassword(DEV_PASSWORD);
    await tx.insert(s.accounts).values(
      users.map((u) => ({
        userId: u.id,
        providerId: 'credential',
        accountId: u.id,
        password: passwordHash,
      })),
    );

    await tx
      .insert(s.creatorProfiles)
      .values(
        Object.entries(creatorProfiles).map(([email, p]) => ({ userId: userId(email), ...p })),
      );

    for (const [seriesIndex, item] of seedSeries.entries()) {
      const [row] = await tx
        .insert(s.series)
        .values({
          creatorId: userId(item.creator),
          slug: item.slug,
          title: item.title,
          description: item.description,
          genres: item.genres,
          status: item.status,
          isPublished: true,
          createdAt: daysFromNow(-90),
        })
        .returning({ id: s.series.id });
      if (!row) throw new Error(`Series ${item.slug} was not inserted`);

      const episodes = Array.from({ length: EPISODES_PER_SERIES }, (_, i) => {
        const number = i + 1;
        // Weekly releases; the newest came out 2 days ago, so it is still in early access.
        const publishedAt = daysFromNow(-2 - (EPISODES_PER_SERIES - number) * 7);
        return {
          seriesId: row.id,
          number,
          title: `Episode ${number}`,
          status: 'published' as const,
          publishedAt,
          ...defaultEpisodeAccess(number, publishedAt),
        };
      });

      // A few special cases so every branch of the access rule has data to look at.
      const special = (number: number) => {
        const episode = episodes[number - 1];
        if (!episode) throw new Error(`Episode ${number} missing`);
        return episode;
      };
      if (seriesIndex === 1) Object.assign(special(7), { accessType: 'free', freeAfter: null }); // permanently free
      if (seriesIndex === 3) Object.assign(special(8), { freeAfter: null }); // permanently subscriber-only
      if (seriesIndex === 5) {
        // Scheduled, not yet published: readers must not see it.
        Object.assign(special(10), {
          status: 'draft',
          publishedAt: null,
          freeAfter: null,
          scheduledAt: daysFromNow(3),
        });
      }

      await tx.insert(s.episodes).values(episodes);
    }

    const plans = await tx
      .insert(s.plans)
      .values([
        {
          code: 'monthly',
          name: 'Monthly',
          interval: PLAN_PRICES.monthly.interval,
          priceMinor: PLAN_PRICES.monthly.priceMinor,
          currency: PLAN_PRICES.monthly.currency,
        },
        {
          code: 'yearly',
          name: 'Yearly',
          interval: PLAN_PRICES.yearly.interval,
          priceMinor: PLAN_PRICES.yearly.priceMinor,
          currency: PLAN_PRICES.yearly.currency,
        },
      ])
      .returning({ id: s.plans.id, code: s.plans.code });
    const planId = (code: string) => {
      const plan = plans.find((p) => p.code === code);
      if (!plan) throw new Error(`Plan ${code} missing`);
      return plan.id;
    };

    const [active, expired] = await tx
      .insert(s.subscriptions)
      .values([
        {
          // reader1: active monthly subscriber, 10 days into the period.
          userId: userId('reader1@inkline.test'),
          planId: planId('monthly'),
          status: 'active',
          provider: 'payway',
          currentPeriodStart: daysFromNow(-10),
          currentPeriodEnd: daysFromNow(20),
          createdAt: daysFromNow(-40),
        },
        {
          // reader2: yearly subscription that ran out over a month ago.
          userId: userId('reader2@inkline.test'),
          planId: planId('yearly'),
          status: 'expired',
          provider: 'payway',
          currentPeriodStart: daysFromNow(-400),
          currentPeriodEnd: daysFromNow(-35),
          createdAt: daysFromNow(-400),
        },
      ])
      .returning({ id: s.subscriptions.id, userId: s.subscriptions.userId });
    if (!active || !expired) throw new Error('Subscriptions were not inserted');

    await tx.insert(s.payments).values([
      {
        subscriptionId: active.id,
        userId: active.userId,
        provider: 'payway',
        providerTxnId: 'seed-txn-0001',
        amountMinor: PLAN_PRICES.monthly.priceMinor,
        currency: CURRENCY,
        status: 'succeeded',
        idempotencyKey: 'seed-payment-0001',
        createdAt: daysFromNow(-10),
      },
      {
        subscriptionId: expired.id,
        userId: expired.userId,
        provider: 'payway',
        providerTxnId: 'seed-txn-0002',
        amountMinor: PLAN_PRICES.yearly.priceMinor,
        currency: CURRENCY,
        status: 'succeeded',
        idempotencyKey: 'seed-payment-0002',
        createdAt: daysFromNow(-400),
      },
    ]);
  });

  console.info(
    `Seeded ${seedUsers.length} users (1 admin, 2 creators, 5 readers), ${seedSeries.length} series × ` +
      `${EPISODES_PER_SERIES} episodes, 2 plans, 2 subscriptions (reader1 active, reader2 expired). ` +
      `All users sign in with the password "${DEV_PASSWORD}".`,
  );
} finally {
  await close();
}
