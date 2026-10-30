# Inkline

A mobile-first web platform for reading webtoons and comics, at inkline.com. The first 3 episodes of every series are free; subscribers ($4.99/month or $49.99/year) read new episodes 7 days early.

The full spec, stack and rules are in [CLAUDE.md](CLAUDE.md). The approved static design is in [design/prototype](design/prototype) (open `index.html`).

## Repository layout

| Path                 | What it is                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | Next.js app (App Router, Tailwind, next-intl): site, reader, studio, admin |
| `apps/worker`        | BullMQ workers: image processing, billing, scheduled jobs                  |
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
- **Submitting an episode** checks every page really is in storage, fixes the page order, sets the episode to `processing` and queues a `process-episode` job. The worker receives it today but only logs it: turning the pages into optimized images and publishing the episode is Phase 4.
- **Permissions.** Every studio server action calls `requireSeriesOwner` / `requireEpisodeOwner` first, so only the series owner or an admin can change a series or its episodes, even when an action is called directly. `apps/web/src/server/actions/studio.test.ts` and the Playwright test "a creator cannot open or change another creator's series" prove it.
- **Browser uploads need CORS on the bucket.** MinIO allows all origins by default. For Cloudflare R2, add a CORS policy to both buckets allowing `PUT` (and `GET`/`HEAD`) from your site's origin with the `Content-Type` header.

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
- [ ] Phases 4–11: images, public site and reader, engagement, subscriptions, PayWay, security, admin, deployment

# Arn-Leng-APP
