# Inkline

A mobile-first web platform for reading webtoons and comics, at inkline.com. The first 3 episodes of every series are free; subscribers ($4.99/month or $49.99/year) read new episodes 7 days early.

The full spec, stack and rules are in [CLAUDE.md](CLAUDE.md). The approved static design is in [design/prototype](design/prototype) (open `index.html`).

## Repository layout

| Path                 | What it is                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | Next.js app (App Router, Tailwind, next-intl): site, reader, studio, admin |
| `apps/worker`        | BullMQ workers: image processing, scheduled publishing, billing            |
| `packages/db`        | Drizzle schema, migrations (`drizzle/`), seed script                       |
| `packages/shared`    | Business constants, Zod schemas, shared types, access rules                |
| `packages/payments`  | PaymentProvider interface and ABA PayWay (Phases 7–8)                      |
| `packages/storage`   | S3/R2 helpers: object keys, presigned uploads, object checks               |
| `packages/config`    | Shared TypeScript, ESLint, Prettier and Tailwind theme                     |
| `docker-compose.yml` | PostgreSQL, Redis and MinIO for local development                          |

## Requirements

- Node.js 22.12+ (24 recommended, see `.nvmrc`)
- pnpm 10 — run `corepack enable` once and the right version is used automatically
- Docker Desktop (or another Docker engine with Compose v2)

## Local setup

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm services:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm services:up` starts PostgreSQL (5432), Redis (6379) and MinIO (API 9000, console 9001) and creates two buckets: `inkline-private` for episode pages and `inkline-public` (anonymous read) for covers and avatars. Plain `docker compose up` works too.

`pnpm dev` starts the web app at http://localhost:3000 and the worker. Both validate their environment with Zod on startup and list every missing or invalid variable if `.env` is incomplete.

If PostgreSQL is already installed on your machine (Homebrew, Postgres.app) it may hold port 5432, and `localhost:5432` then reaches it instead of Docker (error: `role "inkline" does not exist`). Set `POSTGRES_PORT=5433` in `.env`, change the port in `DATABASE_URL` to 5433, and run `docker compose up -d postgres` again.

MinIO console: http://localhost:9001 (user `inkline`, password `inkline-secret`, local only).

## Database

The database can be the Docker PostgreSQL or a Supabase project. For Supabase, set `DATABASE_URL` to the transaction-mode pooler (port 6543) and `DIRECT_URL` to the session-mode pooler (port 5432), both with `?sslmode=require`; see `.env.example`. Only Supabase's PostgreSQL is used: no Supabase Auth or client library. Every table has row-level security on with no policies, so Supabase's Data API (the anon key) can't read anything, while the app, connecting as the database owner, is unaffected.

The schema lives in `packages/db/src/schema` (one file per area: users, content, engagement, billing, system). Enum values come from `packages/shared/src/enums.ts`, so app code and the database share one list.

- Change the schema, then `pnpm db:generate` writes a new SQL migration to `packages/db/drizzle/`. Commit it.
- `pnpm db:migrate` applies pending migrations. It only needs `drizzle-orm`, so deployments run it too.
- `pnpm db:seed` **deletes all data** and loads a known development data set. It refuses when `NODE_ENV=production`, and on a non-local database (such as Supabase) unless you run `pnpm db:seed --allow-remote`:
  - users `admin@inkline.test`, creators `mina@inkline.test` and `leo@inkline.test`, readers `reader1@inkline.test` … `reader5@inkline.test` (all verified, password `inkline-dev-password`; the admin is asked to set up 2FA on first log in);
  - 6 series × 10 weekly episodes; in each series episodes 1–3 are free, episode 10 is still in early access, older ones are free again. Special cases: _Paper Crowns_ ep 7 is permanently free, _Neon Courier_ ep 8 is permanently subscriber-only, _Iron Orchard_ ep 10 is a scheduled draft;
  - the monthly and yearly plans; reader1 has an active monthly subscription, reader2 an expired yearly one.
- `pnpm db:studio` opens Drizzle Studio to browse the data.

The episode access rule (who may read what) is `getEpisodeAccess` in `packages/shared/src/access.ts`, with its tests next to it.

## Creator studio and uploads

Creators and admins manage their work at `/studio`: create and edit a series (title, web address, description, genres, status, age rating, language, cover), then add episodes. An episode has a title, an access setting (free, subscribers first for 7 days, or subscribers only; the first 3 episodes default to free), an optional publish time, a thumbnail and its pages. Drafts can be reordered (they swap numbers with the neighbouring draft) and deleted; published episodes keep their numbers.

- **Uploads never pass through the web server.** The browser asks `POST /api/uploads/presign` for presigned PUT URLs and uploads straight to MinIO (Cloudflare R2 in production). The endpoint checks that you're signed in, own the target series or episode, and that each file is a JPEG, PNG or WebP of at most 20 MB; the file type and exact size are part of the signed URL, so storage rejects anything else. URLs expire after 10 minutes, and each user may request 300 URLs per 10 minutes.
- **Where files go.** Episode pages: private bucket, `uploads/{episodeId}/{uuid}.{ext}`. Covers, thumbnails and avatars: public bucket (`covers/`, `thumbnails/`, `avatars/`). The public bucket's address is `S3_PUBLIC_BASE_URL` (defaults to MinIO).
- **Submitting an episode** checks every page really is in storage, fixes the page order, sets the episode to `processing` and queues a `process-episode` job; see [Image processing](#image-processing) for what the worker does next.
- **Permissions.** Every studio server action calls `requireSeriesOwner` / `requireEpisodeOwner` first, so only the series owner or an admin can change a series or its episodes, even when an action is called directly. `apps/web/src/server/actions/studio.test.ts` and the Playwright test "a creator cannot open or change another creator's series" prove it.
- **Browser uploads need CORS on the bucket.** MinIO allows all origins by default. For Cloudflare R2, add a CORS policy to both buckets allowing `PUT` (and `GET`/`HEAD`) from your site's origin with the `Content-Type` header.

## Public site and reader

- **Pages:** `/` (featured, new episodes, trending this week, browse by genre), `/series/[slug]`, `/genres/[genre]`, `/search`, `/ranking`, `/library`, `/subscribe` and the reader at `/series/[slug]/[number]`.
- **Caching:** home, series and genre pages are built once and kept for everyone (5 minutes as a safety net); the worker asks the web app to rebuild them whenever an episode is published, and studio edits do the same. They don't depend on who is signed in: the account menu and "Continue reading" load in the browser. The reader is different for every reader, so it is never cached (`Cache-Control: no-store`).
- **Reader access:** the server decides with the access rule from `CLAUDE.md` first. Only if the reader may read the episode does it ask `packages/storage` for image addresses, so a locked episode returns just the lock screen (no addresses, no storage keys, no blur previews). `POST /api/episodes/{id}/image-urls` applies the same rule. Both are rate limited per user (or per IP when signed out).
- **Image addresses** are signed in 5-minute windows, so everyone in a window gets the same addresses (browsers can reuse images) and each stays valid for 10 to 15 minutes. The reader asks for fresh ones for chunks that haven't loaded yet when they are close to expiring. Swapping in a Cloudflare Worker later only means replacing `createPresignedEpisodeImageSigner`.
- **Reading progress:** saved for signed-in readers while they scroll (every 2 seconds at most, and when the tab is hidden); the series page then offers "Continue Ep. N".
- **Performance:** Lighthouse (mobile, production build, local database) scored 100 on home and 93 to 100 on series and reader pages, with no layout shift. To measure yourself: `pnpm --filter @inkline/web build`, then `next start`, then Lighthouse. A production build needs real secrets (not the development placeholders), `RESEND_API_KEY` and Turnstile keys.
- **Sample content:** `pnpm seed:images` also makes covers for the seeded series.

## Engagement, rankings and search

- **Follow and like:** `PUT /api/follows/{seriesId}` and `PUT /api/episodes/{id}/like` (idempotent, signed-in only). Counts are shown on the series page and in the studio.
- **My library** (`/library`): three tabs, _Following_, _Continue reading_ and _History_ (with "Clear history"). Per user, never cached.
- **Comments:** plain text, 1 to 1000 characters, rate limited, newest first with cursor pagination on `(created_at, id)`. They follow the episode's access rule, so a locked episode's comments are not readable either. Who may do what is decided in one place, `packages/shared/src/engagement.ts`: you delete your own; you report other people's; a creator hides comments on their own series; an admin hides any (hidden comments stay visible, marked, to those who can hide them). Reports are stored (`reports`); the review queue arrives with the admin area (Phase 10).
- **Views:** the reader calls `POST /api/views` once per page load. A Redis key `view:{episode}:{viewer}` with a 30-minute expiry (`SET NX EX`) decides whether it counts, so refreshing adds nothing; the viewer is the user, or a random `inkline_device` cookie when signed out. A counted view increments `views:pending` and today's ranking set. The creator's own reading is not counted. The worker's `flush-views` job (every 60 s) renames `views:pending`, adds it to `episode_views_daily` and deletes it; if it crashes midway the next run finishes the renamed hash first.
- **Rankings:** Redis sorted sets `rank:day:{YYYY-MM-DD}` (kept 8 days). Daily is today's set; weekly is a `ZUNIONSTORE` of the last 7 days, cached 2 minutes. If Redis is empty (restart) the ranking is rebuilt from `episode_views_daily`. Shown on the home page (top 5, weekly) and at `/ranking/daily` and `/ranking/weekly`.
- **Search:** `GET /api/search?q=&genre=` and `/search` (input debounced 250 ms, URL kept in sync). PostgreSQL full-text (`to_tsvector('simple', title || description || creator_name)`) with the GIN index `series_search_idx`; the expression in the query must stay identical to the index. `series.creator_name` is a copy of the creator's pen name kept so one index can cover it.
- **Notifications:** when an episode is published (by `process-episode` or `publish-scheduled`) the worker queues `notify-followers` (one job per episode). It creates an in-app notification per follower (unique per user and episode) and, for followers who turned on email in their account, sends emails in batches of 100. Only users whose notification was created in that run get an email, so a retry never emails twice. The bell in the header shows the unread count; `/notifications` lists them. Without `RESEND_API_KEY` the worker only logs that it would have sent an email.
- **Creator stats:** each series page in `/studio` shows views for the last 30 days (daily chart and per episode), followers and likes.
- **Seed data:** `pnpm db:seed` adds follows, likes, comments, 30 days of views and one unread notification.

## Subscriptions and access control

- **Plans:** `/subscribe` (monthly $4.99, yearly $49.99, perks, FAQ). `/premium` redirects there. The locked screen in the reader links to `/subscribe?return=…`, so "Continue reading" brings you back to the episode.
- **State machine:** `packages/shared/src/billing.ts` (`activate`, `renew`, `markPastDue`, `cancelAtPeriodEnd`, `resume`, `expire`). They take a state and return the next one, or throw `InvalidTransitionError`; every status × action pair is unit tested. The database code (`apps/web/src/server/billing/*`) only calls them. Canceling sets status `canceled` (still entitled until `current_period_end`); the worker's `expire-subscriptions` job (every 10 minutes) moves it to `expired`, but access never waits for that job because the access rule compares dates with the clock.
- **Payments:** `packages/payments` has the `PaymentProvider` interface (CLAUDE.md's six methods) and `FakePaymentProvider` (success, failure, delayed callback; signed callbacks; the "real" status is only available through `getTransactionStatus`). The fake is development and test only: its pages (`/checkout/fake/…`, `/api/dev/…`, `/api/webhooks/payments/fake`) return 404 in production, and `getPaymentProvider()` in `server/billing/provider.ts` is the one place PayWay replaces it in Phase 8.
- **Never trust the redirect:** checkout (`POST /api/checkout`) only records a pending payment. Access starts in `server/billing/callbacks.ts`, which (1) verifies the callback signature, (2) records `webhook_events.event_id` so a repeat does nothing, (3) asks the provider for the real status, (4) checks amount and currency against the payment, and only then marks it `succeeded` and creates the subscription, in one transaction. The "Confirming your payment" page (`/subscribe/confirm`) polls `GET /api/payments/{id}/status`, which only reads our own records.
- **Account > Subscription** (`/account/subscription`): plan, next billing date, payment history, cancel (keeps access until the period ends), resume, and switch plan at the next renewal (`subscriptions.next_plan_id`; applied by the renewal job in Phase 8).
- **Entitlement cache:** a user's subscriptions are cached in Redis for 60 s (`entitlement:{userId}`) and cleared by every code path that changes one (payment verified, cancel, resume, switch, admin grant, worker expiry). The reader's access check uses it. It caches the subscriptions, not a yes/no answer, so a canceled subscription still stops at its end date.
- **Complimentary subscriptions:** admins open `/admin/subscriptions` (or `POST /api/admin/subscriptions/grant`) to give someone 1, 3, 6 or 12 months. It is a real subscription with provider `complimentary`, no payments and no renewal, and is written to `audit_logs` (`subscription.grant_complimentary`, with the admin as actor). Payment results are audited too (`payment.succeeded`, `payment.failed`, `payment.mismatch`).
- **Not in this phase:** real payments, saved card tokens, renewals and retries, the daily reconciliation job and refunds (Phase 8); the full admin dashboard (Phase 10).
- **Trying it:** sign in, open a locked episode, press Subscribe, pick a plan, then choose an outcome on the test payment page ("Pay now", "Pay now, confirmation arrives late" or "Decline").

## Security

The full description and the audit of every route and server action is in [docs/security.md](docs/security.md). In short:

- **Headers and CSP:** `src/proxy.ts` gives pages a nonce-based Content-Security-Policy (see the doc for why the few cached public pages are the exception), plus HSTS, `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` and more. API routes refuse POST/PUT/PATCH/DELETE from another website.
- **Rate limits** on every API route and server action, and an hourly cap on image addresses. An account given more than 20 different episodes in 5 minutes is flagged at `/admin/flags` (nothing is blocked automatically).
- **Image access:** presigned bucket URLs by default. For production, deploy the Cloudflare Worker in `apps/edge-images` (`npx wrangler deploy`, with the R2 binding in `wrangler.toml`) and set `IMAGE_EDGE_URL` and `IMAGE_EDGE_SECRET` (the same value as the Worker's `IMAGE_TOKEN_SECRET`). The reader doesn't change. Tokens name the episode, user and expiry; the Worker rejects expired or tampered ones.
- **Watermark (optional, off):** `WATERMARK_ENABLED=true` serves subscribers a lossless copy of paid chunks with their user id hidden in it. **Watermarked images are made per person, so they cannot be shared through the edge cache or a CDN**, and they only survive lossless copies. See the doc.
- **Account security:** `/account/sessions` lists devices with "log out everywhere"; emails go out on a new-device sign-in and on a password change.
- **CI:** gitleaks (secret scan) and `pnpm audit --audit-level high` run on every push and pull request; Dependabot opens weekly update PRs. They run on GitHub, not locally.
- **Tests:** `e2e/cross-user.spec.ts` proves user A cannot read or change user B's account, progress, subscription, payments or drafts; `e2e/security-headers.spec.ts` checks the headers and that no CSP violation happens on the main pages; the Worker's tests cover expired and tampered tokens.

## Image processing

When a creator submits an episode, the web app sets it to `processing` and queues a `process-episode` job. The worker (`apps/worker`) then:

1. downloads the uploaded originals from the private bucket, in page order, and checks each one is really an image (from its bytes, not its name), within 20 MB and 2000 px wide;
2. scales every page to the **first page's width** (capped at 2000 px) so pages line up;
3. cuts any page taller than 1600 px into chunks of about 1280 px (a last piece under 400 px is merged into the chunk before it), one page at a time to keep memory low;
4. makes each chunk at **480, 800 and 1200 px wide, never larger than the chunk itself**, in **AVIF and WebP**, plus a tiny blur placeholder (e.g. one 800 x 5000 page becomes 4 chunks and 16 files);
5. stores the files as `episodes/{episodeId}/{contentHash}/{position}-{width}.{avif|webp}` with `Cache-Control: public, max-age=31536000, immutable` (the hash covers the originals and the processing settings, so the same input always gives the same keys), and saves one `episode_images` row per chunk (width, height, blur placeholder, total bytes);
6. moves the originals to `originals/{episodeId}/` so the episode can be processed again later;
7. publishes the episode (`published_at`, and `free_after` from the episode's early-access setting), or, if the creator scheduled it for later, puts it back to `draft` until its time comes.

- **Scheduled publishing:** the `publish-scheduled` job runs every minute and publishes drafts whose time has passed and whose images are ready.
- **Retries and failures:** a job is tried again 3 times with exponential backoff (5 s, 10 s, 20 s). A file that can't be fixed by retrying (not an image, damaged, too big or too wide) fails at once. After the last failure the episode becomes `failed`, the reason is saved in `episodes.processing_error`, and the studio shows it in plain words with a **Try again** button.
- **Concurrency:** at most 2 image jobs (episodes and covers together) run at a time (`IMAGE_JOB_CONCURRENCY`).
- **Covers, thumbnails and avatars:** a `process-cover` job makes three sizes in AVIF and WebP in the public bucket, next to the original: `covers/{id}/{uuid}.png` gets `covers/{id}/{uuid}/{240|480|800}.{avif|webp}` (avatars: 64/128/256, cropped square).
- **Page refresh:** after publishing, the worker calls `POST /api/internal/revalidate` on the web app (protected by `INTERNAL_API_SECRET`) so cached home and series pages update. Those public pages arrive in Phase 5.
- **Sample images:** `pnpm seed:images` draws sample comic pages for the seeded episodes and runs them through this same pipeline (options: `--series a,b`, `--episodes 3`, `--pages 3`, `--force`). It only touches series owned by `@inkline.test` users.

## Authentication and roles

[Better Auth](https://better-auth.com) runs inside the web app at `/api/auth/*`, on our own tables (`users`, `sessions`, `accounts`, `verifications`, `two_factors`). Sign-in methods: email + password (email confirmation required), Google and Facebook, plus optional authenticator-app 2FA.

- **Pages:** `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/account` (name, language, password, 2FA), `/become-creator`. `/studio` is for creators and admins, `/admin` for admins; everyone else gets HTTP 403.
- **Guards** (`apps/web/src/server/auth/session.ts`): call `requireUser()`, `requireRole('creator', 'admin')` or `requireSeriesOwner(seriesId)` at the top of every protected page, server action and route handler. The role rules themselves are the pure function `authorize()` in `packages/shared/src/authz.ts`. Admins without 2FA are redirected to `/account?setup2fa=1` and can't turn it off.
- **Sessions:** httpOnly, SameSite=Lax cookie (plus Secure in production), 7 days, read from the database on every request (no cookie cache), so role changes and sign-outs apply immediately.
- **Rate limits** (Redis): 5 failed log-ins per email per 10 minutes (the 6th is blocked, even with the right password), and 20 failed log-ins per IP; 5 sign-ups per IP; 5 password-reset / resend-confirmation requests per IP and per email. Cloudflare Turnstile guards sign-up and password reset.
- **Email** goes through the `EmailSender` interface (`apps/web/src/server/email`): Resend when `RESEND_API_KEY` is set, otherwise the console. In development each email is printed in the `pnpm dev` terminal and also appended to `.dev-mail/outbox.jsonl` (git-ignored), so you can copy confirmation and reset links from there.
- **Social login:** set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and/or `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` in `.env`; each button appears only when its keys are set. The redirect URL to register with the provider is `<NEXT_PUBLIC_SITE_URL>/api/auth/callback/google` (or `/facebook`).
- **Turnstile** uses Cloudflare's published test keys from `.env.example` locally. Production needs real keys, a real `RESEND_API_KEY` and its own `BETTER_AUTH_SECRET` (`openssl rand -base64 32`); the web app refuses to start without them.

### Check that the worker runs

With `pnpm dev` running, in another terminal:

```bash
pnpm example-job
```

It queues an example job and prints the worker's reply, e.g. `Hello, Inkline! The Inkline worker is running.` The worker logs the finished job too.

## Scripts

| Command                              | What it does                                                               |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `pnpm dev`                           | Web and worker in watch mode                                               |
| `pnpm build`                         | Production build of the web app                                            |
| `pnpm typecheck`                     | TypeScript in every package (strict mode)                                  |
| `pnpm lint`                          | ESLint in every package                                                    |
| `pnpm test`                          | Vitest unit tests                                                          |
| `pnpm test:e2e`                      | Playwright end-to-end tests (starts `pnpm dev` if nothing is on port 3000) |
| `pnpm format`                        | Prettier                                                                   |
| `pnpm services:up` / `services:down` | Start or stop the Docker services                                          |
| `pnpm db:generate`                   | Write a migration from schema changes                                      |
| `pnpm db:migrate`                    | Apply pending migrations (uses `DIRECT_URL` if set)                        |
| `pnpm db:seed`                       | Reset the database to the development seed data                            |
| `pnpm db:studio`                     | Browse the database in Drizzle Studio                                      |
| `pnpm seed:images`                   | Make sample comic pages for the seeded episodes and process them           |

The first time you run end-to-end tests, install the browser: `pnpm --filter @inkline/web exec playwright install chromium`. They need `.env`, the services (Redis) and a migrated database, like `pnpm dev`, and they need internet access for Cloudflare's Turnstile. The sign-up tests create users named `e2e-…@inkline.test` and delete them when the run ends.

## Environment

All apps read one `.env` at the repo root (see `.env.example` for every variable and what it's for). Production sets variables directly; there is no file.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: install, format check, typecheck, lint and unit tests.

## Phases

The build follows the phase plan in the project's build prompt. Each phase ends with typecheck, lint and tests passing, then a commit tagged `phase-N`.

- [x] Phase 0: project setup
- [x] Phase 1: database and access rule
- [x] Phase 2: authentication and roles
- [x] Phase 3: creator studio and uploads
- [x] Phase 4: image processing worker
- [x] Phase 5: public site and reader
- [x] Phase 6: engagement, rankings and search
- [x] Phase 7: subscriptions and access control (fake payment provider)
- [ ] Phase 8: payments with ABA PayWay (**not built**: the PayWay docs for saved cards, charging a token, refunds and the transaction list could not be read, and there are no sandbox credentials yet)
- [x] Phase 9: security hardening and anti-piracy
- [ ] Phases 10–11: admin, deployment

# Arn-Leng-APP
