# Inkline

A mobile-first web platform for reading webtoons and comics, at inkline.com. The first 3 episodes of every series are free; subscribers ($4.99/month or $49.99/year) read new episodes 7 days early.

The full spec, stack and rules are in [CLAUDE.md](CLAUDE.md). The approved static design is in [design/prototype](design/prototype) (open `index.html`).

## Repository layout

| Path                 | What it is                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | Next.js app (App Router, Tailwind, next-intl): site, reader, studio, admin |
| `apps/worker`        | BullMQ workers: image processing, billing, scheduled jobs                  |
| `packages/db`        | Drizzle schema, migrations, seed (Phase 1)                                 |
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
pnpm dev
```

`pnpm services:up` starts PostgreSQL (5432), Redis (6379) and MinIO (API 9000, console 9001) and creates two buckets: `inkline-private` for episode pages and `inkline-public` (anonymous read) for covers and avatars. Plain `docker compose up` works too.

`pnpm dev` starts the web app at http://localhost:3000 and the worker. Both validate their environment with Zod on startup and list every missing or invalid variable if `.env` is incomplete.

MinIO console: http://localhost:9001 (user `inkline`, password `inkline-secret`, local only).

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

The first time you run end-to-end tests, install the browser: `pnpm --filter @inkline/web exec playwright install chromium`. They need `.env` and the services, like `pnpm dev`.

## Environment

All apps read one `.env` at the repo root (see `.env.example` for every variable and what it's for). Production sets variables directly; there is no file.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: install, format check, typecheck, lint and unit tests.

## Phases

The build follows the phase plan in the project's build prompt. Each phase ends with typecheck, lint and tests passing, then a commit tagged `phase-N`.

- [x] Phase 0: project setup
- [ ] Phase 1: database and access rule
- [ ] Phase 2: authentication and roles
- [ ] Phase 3: creator studio and uploads
- [ ] Phases 4–11: images, public site and reader, engagement, subscriptions, PayWay, security, admin, deployment
