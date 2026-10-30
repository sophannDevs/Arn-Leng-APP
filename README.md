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
| `packages/storage`   | R2/S3 helpers (Phase 3)                                                    |
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
  - users `admin@inkline.test`, creators `mina@inkline.test` and `leo@inkline.test`, readers `reader1@inkline.test` … `reader5@inkline.test` (no passwords until Phase 2);
  - 6 series × 10 weekly episodes; in each series episodes 1–3 are free, episode 10 is still in early access, older ones are free again. Special cases: _Paper Crowns_ ep 7 is permanently free, _Neon Courier_ ep 8 is permanently subscriber-only, _Iron Orchard_ ep 10 is a scheduled draft;
  - the monthly and yearly plans; reader1 has an active monthly subscription, reader2 an expired yearly one.
- `pnpm db:studio` opens Drizzle Studio to browse the data.

The episode access rule (who may read what) is `getEpisodeAccess` in `packages/shared/src/access.ts`, with its tests next to it.

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

The first time you run end-to-end tests, install the browser: `pnpm --filter @inkline/web exec playwright install chromium`. They need `.env` and the services, like `pnpm dev`.

## Environment

All apps read one `.env` at the repo root (see `.env.example` for every variable and what it's for). Production sets variables directly; there is no file.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: install, format check, typecheck, lint and unit tests.

## Phases

The build follows the phase plan in the project's build prompt. Each phase ends with typecheck, lint and tests passing, then a commit tagged `phase-N`.

- [x] Phase 0: project setup
- [x] Phase 1: database and access rule
- [ ] Phase 2: authentication and roles
- [ ] Phase 3: creator studio and uploads
- [ ] Phases 4–11: images, public site and reader, engagement, subscriptions, PayWay, security, admin, deployment
# Arn-Leng-APP
