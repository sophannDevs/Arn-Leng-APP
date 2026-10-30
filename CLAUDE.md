# Inkline: Project Spec

## Overview
Inkline is a public, mobile-first web platform for reading webtoons and comics at inkline.com.

Roles:
- Reader: reads, follows series, likes, comments, subscribes.
- Creator: publishes series and episodes, sees basic stats.
- Admin: moderates content, manages users, plans, subscriptions and payments.

Business model: freemium + subscription.
- The first 3 episodes of every series are free.
- New episodes are subscriber-only for 7 days, then become free.
- Creators or admins can also mark an episode as permanently free or permanently subscriber-only.
- Plans: monthly 4.99 and yearly 49.99, in USD.

Languages: English. All UI text goes through i18n from day one.

## Tech stack (do not change without asking)
- Language: TypeScript, strict mode, everywhere.
- Monorepo: pnpm workspaces + Turborepo.
- Web: Next.js (App Router, React Server Components) + Tailwind CSS. Backend = Next.js route handlers and server actions.
- Database: PostgreSQL + Drizzle ORM + drizzle-kit migrations.
- Cache and queues: Redis + BullMQ.
- Image storage: Cloudflare R2 through the S3 API (@aws-sdk/client-s3). MinIO for local development.
- Image processing: sharp.
- Auth: Better Auth (email + password, Google, Facebook; 2FA plugin).
- Validation: Zod for all inputs and environment variables.
- Search: PostgreSQL full-text search (Meilisearch later).
- Email: Resend, behind an EmailSender interface.
- Payments: ABA PayWay (local) and [INTERNATIONAL_PROVIDER] (later), behind a PaymentProvider interface.
- Tests: Vitest (unit and integration), Playwright (end-to-end).
- Monitoring: Sentry (errors), PostHog (analytics).
- Delivery: Docker, GitHub Actions.

## Repository structure
- apps/web: Next.js app (public site, reader, creator studio, admin).
- apps/worker: BullMQ workers (image processing, billing, scheduled jobs).
- packages/db: Drizzle schema, migrations, seed script.
- packages/shared: Zod schemas, types, constants, access rules.
- packages/payments: PaymentProvider interface + PayWay implementation.
- packages/storage: R2/S3 helpers (presigned URLs, object keys).
- packages/config: shared TypeScript, ESLint and Tailwind config.
- docker-compose.yml: PostgreSQL, Redis and MinIO for local development.

## Coding rules
- No `any` unless a comment explains why.
- Validate every input with Zod: bodies, params, search params, form data, webhooks.
- Every server action and API route checks authentication AND authorization on the server. Never trust the client.
- Validate environment variables with Zod at startup. Never commit secrets. Keep .env.example up to date.
- All database access goes through Drizzle. No string-built SQL.
- Money = integer minor units (cents) + currency code. Never floats.
- Store all timestamps in UTC (timestamptz).
- Heavy work (images, emails, billing) runs in apps/worker, never inside a web request.
- Business rules (access, billing, payments) must have unit tests.
- Do not add libraries outside this stack without asking. If a requirement is unclear, ask instead of guessing.

## Data model (core tables)
- users: id, email, name, avatar_key, role (reader | creator | admin), locale, created_at.
- creator_profiles: user_id, pen_name, bio.
- series: id, creator_id, slug (unique), title, description, cover_key, genres, status (ongoing | completed | hiatus), age_rating, language, is_published, created_at, updated_at.
- episodes: id, series_id, number, title, thumbnail_key, status (draft | processing | published | failed), access_type (free | subscriber), free_after, scheduled_at, published_at. Unique (series_id, number).
- episode_images: id, episode_id, position, key_prefix, width, height, blur_data_url, bytes. One row per image chunk.
- follows (user_id, series_id), likes (user_id, episode_id).
- comments: id, episode_id, user_id, body, status (visible | hidden), created_at. reports: id, reporter_id, target_type, target_id, reason, status.
- reading_progress: user_id, series_id, episode_id, scroll_position, updated_at.
- episode_views_daily: episode_id, date, views.
- plans: id, code, name, interval (month | year), price_minor, currency, is_active.
- subscriptions: id, user_id, plan_id, status (active | past_due | canceled | expired), provider, payment_token (encrypted), current_period_start, current_period_end, cancel_at_period_end, grace_until, created_at.
- payments: id, subscription_id, user_id, provider, provider_txn_id (unique), amount_minor, currency, status (pending | succeeded | failed | refunded), failure_reason, idempotency_key (unique), created_at.
- webhook_events: id, provider, event_id (unique), payload, received_at, processed_at.
- audit_logs: id, actor_id, action, target_type, target_id, metadata, created_at.

## Episode access rule (one function in packages/shared, fully unit tested)
A user can read an episode if ANY of these is true:
1. The user is an admin, or the creator who owns the series.
2. episode.number <= 3.
3. episode.access_type = free.
4. episode.free_after is set and now >= free_after.
5. The user has an entitled subscription: status active; or past_due and now < grace_until; or canceled and now < current_period_end.
Default for new episodes after the free ones: access_type = subscriber, free_after = published_at + 7 days.
Readers only ever see published episodes.

## Image rules
- Creators upload straight to R2 with presigned PUT URLs. Files never pass through the web server.
- Accept JPEG, PNG and WebP only. Check the real file type from the file bytes. Max 20 MB per file and 2000 px width (configurable).
- The worker re-encodes every image with sharp (this strips metadata), slices tall images into chunks about 1280 px tall (merge a last piece under 400 px into the previous chunk), creates widths 480, 800 and 1200 px (never upscale) in AVIF and WebP, and makes a tiny blur placeholder.
- Object keys: episodes/{episodeId}/{contentHash}/{position}-{width}.{avif|webp}. Keys are content-hashed, so set Cache-Control: public, max-age=31536000, immutable.
- Episode images live in a PRIVATE bucket. Covers, thumbnails and avatars live in a PUBLIC bucket behind the CDN.
- Episode image URLs come from one function in packages/storage. First version: presigned GET URLs that expire in 10 minutes. Design it so a Cloudflare Worker with signed tokens can replace it later without touching the reader.

## Security rules
- Session cookies: httpOnly, Secure, SameSite=Lax.
- Redis rate limits on login, sign-up, password reset, comments, upload URL creation and image URL issuance.
- Cloudflare Turnstile on sign-up and password reset.
- 2FA required for admins, strongly encouraged for creators.
- Render all user text as plain text. Never use dangerouslySetInnerHTML with user content.
- Security headers: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, frame-ancestors none.
- Encrypt payment tokens at rest (AES-256-GCM, key from environment).
- Write admin and payment actions to audit_logs. Never log secrets, tokens or personal payment data.

## Payment rules
- PaymentProvider interface: createCheckout, chargeSavedToken, verifyCallback, getTransactionStatus, refund, listTransactions.
- Never grant access because of a browser redirect. Grant access only after a verified callback AND a status check with the provider's API.
- Handle every callback idempotently, using webhook_events.event_id and payments.provider_txn_id.
- Renewals run in a daily billing job. After a failed charge, retry on days 1, 3 and 5; grace period 7 days; then expired (all configurable).
- A daily reconciliation job compares our payments with the provider's transaction list and flags mismatches.
- Follow the official ABA PayWay developer documentation exactly and use the sandbox in development. Never invent API fields; if the docs are unclear, stop and ask.

## Performance rules
- Mobile-first. Target Lighthouse performance 90+ on mobile and LCP under 2.5 s for home, series and reader pages.
- Home and series pages are server-rendered and cached; revalidate them when an episode is published.
- Reader page: minimal client JavaScript; first 2 chunks load eagerly, the rest lazily; space reserved from stored width and height; prefetch the next episode's first chunks near the end.
- View counts: Redis INCR, flushed to PostgreSQL every 60 s by the worker. Rankings in Redis sorted sets.
- Cursor pagination for lists. No unbounded queries. No N+1 queries.

## Definition of done (every phase)
- pnpm typecheck, pnpm lint and pnpm test all pass.
- New business rules have tests.
- Migrations generated and committed. .env.example and README updated.

## Visual design
The UI follows the approved static prototype (Comix style), kept in `design/prototype/` for reference:
- Colors: red #D91E1E (hover #B91717), yellow #FFD60A, ink #111111, text #1A1A1A, paper #EFEBE5, white.
- Fonts: Barlow Condensed (600/700) for headings, Bangers for comic lettering and the logo, Poppins (400–700) for body text.
- Shapes: 2px ink borders, 12–18px radii, hard offset shadows (5px 6px 0 #111), starburst logo.
- Tokens live in `packages/config/tailwind/theme.css`. Port prototype pages into real components phase by phase; don't copy its demo-only logic (localStorage state, fake payments, demo role switch).
