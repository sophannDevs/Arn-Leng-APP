# Security

What protects Inkline, where it lives, and the audit of every entry point. Re-run the audit whenever a
route or server action is added (see "Keeping the audit true" at the end).

## Layers

| Layer               | What                                                                                                                                                                                                                                                                                                                             | Where                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Headers             | `Content-Security-Policy`, `Strict-Transport-Security` (production), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `frame-ancestors 'none'`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. API answers get `default-src 'none'`.                                                                         | `src/proxy.ts`, `src/lib/csp.ts`, `next.config.ts`                   |
| CSP and nonces      | Pages rendered per request get a fresh nonce and `'strict-dynamic'`: no inline script runs without it. The few pages built once and cached (home, series, genres, ranking) cannot carry a nonce (Next.js applies it while rendering a request), so they allow same-site inline scripts. They render no user-written HTML at all. | `src/lib/csp.ts`                                                     |
| Cross-site requests | A POST, PUT, PATCH or DELETE to `/api/*` whose `Origin` is another website is refused (403). Cookies are also `SameSite=Lax`.                                                                                                                                                                                                    | `src/proxy.ts`                                                       |
| Sessions            | httpOnly, Secure (production), SameSite=Lax cookies; no cookie cache, so a revoked session or role change applies at once. Sessions list with "log out everywhere"; email on a new device and on a password change.                                                                                                              | `server/auth/auth.ts`, `/account/sessions`                           |
| Permissions         | One function decides each rule (`@inkline/shared`: `authorize`, `getEpisodeAccess`, comment rules). Server code asks it; the UI only shows what it already allowed.                                                                                                                                                              | `packages/shared/src/{authz,access,engagement}.ts`                   |
| Rate limits         | Redis counters. Auth endpoints, uploads, image addresses (burst and per hour), comments, reports, checkout, every signed-in API call (per user), every public API call (per address), every server action (per user).                                                                                                            | `server/auth/rate-limit.ts`, `server/engagement/limits.ts`           |
| Anti-scraping       | Image addresses are capped per user per hour; an account given more than 20 different episodes in 5 minutes is flagged for an admin (nothing is blocked automatically).                                                                                                                                                          | `server/reader/service.ts`, `server/security/scraping.ts`            |
| Image access        | Episode images are in a private bucket. Addresses are presigned (10 min) or, with `IMAGE_EDGE_URL` set, signed tokens checked by the Cloudflare Worker (`apps/edge-images`). Optional per-user invisible watermark on paid episodes, off by default.                                                                             | `packages/storage`, `apps/edge-images`, `server/reader/watermark.ts` |
| Secrets             | Only in environment variables. `.env` is git-ignored; gitleaks scans every push and pull request; saved payment tokens are to be encrypted (Phase 8).                                                                                                                                                                            | `.gitleaks.toml`, `.github/workflows/ci.yml`                         |
| Dependencies        | `pnpm audit --audit-level high` in CI; Dependabot opens weekly update pull requests.                                                                                                                                                                                                                                             | `.github/`                                                           |
| Audit trail         | Admin and payment actions are written to `audit_logs` (never secrets, tokens or card data).                                                                                                                                                                                                                                      | `audit_logs` table                                                   |

## Route audit

Columns: **Who** may call it · **Auth** how the caller is identified · **Ownership** how it is limited to
the caller's own data (or "n/a: public/global") · **Zod** input validation · **Limit** rate limit.
"user" = per signed-in user (`API_USER_RATE_LIMIT`: 240/min), "IP" = per client address
(`API_IP_RATE_LIMIT`: 300/min). Every `/api/*` route also passes the cross-site check in `src/proxy.ts`.

### API routes (`src/app/api`)

| Route                                  | Method(s) | Who                                                                         | Auth                                                              | Ownership                                                                      | Zod                                   | Limit                                                                            |
| -------------------------------------- | --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------- |
| `/api/auth/*` (Better Auth)            | all       | anyone (sign-in, sign-up, reset); signed-in for sessions, password, 2FA     | Better Auth session / credentials; Turnstile on sign-up and reset | Better Auth acts only on the session's own user                                | Better Auth schemas + `emailBody`     | per IP on every call; per email/IP on sign-in, sign-up, reset, verification mail |
| `/api/account/notifications`           | PUT       | signed-in                                                                   | `authorizeApi()`                                                  | updates only the session user's row (no id accepted)                           | `body`                                | user                                                                             |
| `/api/admin/subscriptions/grant`       | POST      | admin (with 2FA)                                                            | `authorizeApi({roles:['admin']})`                                 | n/a (admin acts on any user by email; audited)                                 | `grantComplimentarySchema`            | user                                                                             |
| `/api/admin/flags/[flagId]/review`     | POST      | admin (with 2FA)                                                            | `authorizeApi({roles:['admin']})`                                 | n/a (admin; audited)                                                           | `idSchema`                            | user                                                                             |
| `/api/checkout`                        | POST      | signed-in                                                                   | `authorizeApi()`                                                  | payment is created for the session user                                        | `checkoutInputSchema`                 | user + checkout (10 / 10 min)                                                    |
| `/api/comments/[commentId]`            | DELETE    | signed-in (author)                                                          | `authorizeApi()`                                                  | `canDeleteComment`: own comments only                                          | `idSchema`                            | user                                                                             |
| `/api/comments/[commentId]/hide`       | POST      | creator of the series, or admin                                             | `authorizeApi()`                                                  | `canHideComment` (series creator / admin)                                      | `idSchema`                            | user                                                                             |
| `/api/comments/[commentId]/report`     | POST      | signed-in (not the author)                                                  | `authorizeApi()`                                                  | `canReportComment`                                                             | `idSchema`, `reportInputSchema`       | user + report (per user)                                                         |
| `/api/dev/fake-payments/[txnId]`       | POST      | signed-in; **404 in production**                                            | `authorizeApi()`                                                  | payment must belong to the session user                                        | `fakePayInputSchema`, txn pattern     | user                                                                             |
| `/api/episodes/[episodeId]/comments`   | GET       | anyone who may read the episode                                             | optional session                                                  | `decideAccess` (episode access rule)                                           | `idSchema`, cursor check              | IP                                                                               |
| `/api/episodes/[episodeId]/comments`   | POST      | signed-in who may read the episode                                          | `authorizeApi()`                                                  | `decideAccess`; author is the session user                                     | `idSchema`, `commentInputSchema`      | user + comment (10 / 10 min)                                                     |
| `/api/episodes/[episodeId]/image-urls` | POST      | anyone who may read the episode                                             | optional session                                                  | `decideAccess` before any address is made                                      | `idSchema`, `bodySchema`              | image addresses: user (or IP), burst + hourly                                    |
| `/api/episodes/[episodeId]/like`       | GET       | anyone                                                                      | optional session                                                  | state is the session user's own                                                | `idSchema`                            | IP                                                                               |
| `/api/episodes/[episodeId]/like`       | PUT       | signed-in                                                                   | `authorizeApi()`                                                  | like belongs to the session user                                               | `idSchema`, `body`                    | user                                                                             |
| `/api/follows/[seriesId]`              | GET       | anyone                                                                      | optional session                                                  | state is the session user's own                                                | `idSchema`                            | IP                                                                               |
| `/api/follows/[seriesId]`              | PUT       | signed-in                                                                   | `authorizeApi()`                                                  | follow belongs to the session user                                             | `idSchema`, `body`                    | user                                                                             |
| `/api/history`                         | DELETE    | signed-in                                                                   | `authorizeApi()`                                                  | clears only the session user's history                                         | none needed (no input)                | user                                                                             |
| `/api/internal/revalidate`             | POST      | the worker only                                                             | shared secret, constant-time compare                              | n/a (server to server)                                                         | `bodySchema`                          | IP                                                                               |
| `/api/notifications`                   | GET       | signed-in                                                                   | `authorizeApi()`                                                  | session user's notifications only                                              | none needed                           | user                                                                             |
| `/api/notifications/read`              | POST      | signed-in                                                                   | `authorizeApi()`                                                  | `markNotificationsRead` filters by the session user                            | `body`                                | user                                                                             |
| `/api/payments/[paymentId]/status`     | GET       | signed-in                                                                   | `authorizeApi()`                                                  | query filters by `userId`; others get 404                                      | `idSchema`                            | user                                                                             |
| `/api/progress`                        | POST, GET | signed-in                                                                   | `authorizeApi()`                                                  | row keyed by the session user; series taken from the episode                   | `saveSchema`, `idSchema`              | user                                                                             |
| `/api/search`                          | GET       | anyone                                                                      | none (public data)                                                | n/a: published series only                                                     | `query`                               | IP                                                                               |
| `/api/series/[slug]/episodes`          | GET       | anyone                                                                      | none (public data)                                                | n/a: published series and episodes only                                        | `querySchema`                         | IP                                                                               |
| `/api/subscription/cancel`             | POST      | signed-in                                                                   | `authorizeApi()`                                                  | acts on the session user's own subscription only                               | none needed                           | user                                                                             |
| `/api/subscription/resume`             | POST      | signed-in                                                                   | `authorizeApi()`                                                  | same                                                                           | none needed                           | user                                                                             |
| `/api/subscription/switch`             | POST      | signed-in                                                                   | `authorizeApi()`                                                  | same                                                                           | `switchPlanInputSchema`               | user                                                                             |
| `/api/uploads/presign`                 | POST      | signed-in (creators for series files; any user for own avatar)              | `authorizeApi()`                                                  | `canManageSeries` on the target series / episode; avatar is the session user's | `presignRequestSchema`, body size cap | user + upload (per file)                                                         |
| `/api/views`                           | POST      | anyone who may read the episode                                             | optional session                                                  | `decideAccess`; staff reading their own series are not counted                 | `body`                                | IP, plus once per viewer per 30 min                                              |
| `/api/watermark`                       | GET       | signed-in who may read the episode; **404 unless `WATERMARK_ENABLED=true`** | session                                                           | `decideAccess`; copy is made for the session user                              | `query`                               | user + watermark (600 / 10 min)                                                  |
| `/api/webhooks/payments/fake`          | POST      | the fake provider; **404 in production**                                    | HMAC signature on the body                                        | n/a (the signed transaction id); status re-checked with the provider           | `verifyCallback` shape check          | IP                                                                               |

### Server actions (`src/server/actions`)

All server actions are public HTTP endpoints, so each one authorizes first, validates its argument, and
takes the user from the session (never from the argument). All are limited to 60 calls a minute per
user (`ACTION_RATE_LIMIT`) and answer `rateLimited` beyond that.

| Action                      | Who               | Auth                       | Ownership                                      | Zod                              |
| --------------------------- | ----------------- | -------------------------- | ---------------------------------------------- | -------------------------------- |
| `updateProfileAction`       | signed-in         | `requireUser`              | session user's own row                         | `profileSchema`                  |
| `becomeCreatorAction`       | signed-in readers | `requireUser` + role check | session user; audited                          | `becomeCreatorSchema`            |
| `setAvatarAction`           | signed-in         | `requireUser`              | key must be under the user's own prefix        | key check + `verifyPublicUpload` |
| `getAdminOverviewAction`    | admin             | `requireRole('admin')`     | n/a (counts)                                   | none (no input)                  |
| `createSeriesAction`        | creators, admins  | `requireRole`              | series is created for the session user         | `seriesInputSchema`              |
| `updateSeriesAction`        | owner or admin    | `requireSeriesOwner`       | `canManageSeries`                              | `seriesInputSchema`              |
| `setSeriesCoverAction`      | owner or admin    | `requireSeriesOwner`       | `canManageSeries`; key under the series prefix | key check                        |
| `createEpisodeAction`       | owner or admin    | `requireSeriesOwner`       | `canManageSeries`                              | `episodeInputSchema`             |
| `updateEpisodeAction`       | owner or admin    | `requireEpisodeOwner`      | `canManageSeries` via the episode's series     | `episodeInputSchema`             |
| `setEpisodeThumbnailAction` | owner or admin    | `requireEpisodeOwner`      | same; key under the episode prefix             | key check                        |
| `deleteEpisodeAction`       | owner or admin    | `requireEpisodeOwner`      | same                                           | `idSchema`                       |
| `moveEpisodeAction`         | owner or admin    | `requireEpisodeOwner`      | same                                           | `directionSchema`                |
| `submitEpisodeAction`       | owner or admin    | `requireEpisodeOwner`      | same; uploads must belong to the episode       | `submitEpisodeSchema`            |
| `retryProcessingAction`     | owner or admin    | `requireEpisodeOwner`      | same                                           | `idSchema`                       |

### Pages that read private data

Pages are protected the same way (`requireUser`, `requireRole`, `requireSeriesOwner`, `requireEpisodeOwner`
at the top, 403 for the wrong user). Checked by `e2e/cross-user.spec.ts`: `/account*`, `/library`,
`/notifications`, `/subscribe/confirm`, `/checkout/fake/*`, `/studio/*`, `/admin/*`.

### Not built yet

- **ABA PayWay (Phase 8 was skipped):** `/api/payments/payway/callback` and the billing, reconciliation
  and update-payment-method routes do not exist. **They are not covered by this audit and it must be
  re-run when Phase 8 lands.** Also then: encrypted saved tokens, callback signature checks, billing locks.
  The fake provider covers none of these.
- **CSP and PayWay:** PayWay's checkout may need `form-action`, `frame-src` or `script-src` allowances. No
  PayWay hosts are listed because none are documented yet; add them in `src/lib/csp.ts` with Phase 8.

## Gaps found by the audit, and fixed

| Gap                                                                                       | Fix                                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| No Content-Security-Policy or other security headers                                      | `src/proxy.ts`, `src/lib/csp.ts`, `next.config.ts`                      |
| Most API routes and all server actions had no rate limit                                  | per-user and per-IP limiters on every route; action limiter             |
| Any website could POST to our API with a visitor's cookies (only SameSite=Lax stopped it) | Origin check in `src/proxy.ts`                                          |
| Image addresses limited per 10 minutes only                                               | added an hourly cap                                                     |
| No way to notice an account reading faster than a person                                  | `server/security/scraping.ts` flags it; admins review at `/admin/flags` |
| Public callback and internal endpoints had no ceiling                                     | per-IP limiter                                                          |
| Better Auth endpoints other than sign-in/up/reset had no limit                            | per-IP limiter on every auth call                                       |
| No notice when a new device signs in or a password changes                                | emails + `/account/sessions`                                            |

## Image access, in two steps

1. **Presigned (default):** short-lived signed bucket URLs, issued only after the access rule passes.
2. **Edge (production):** set `IMAGE_EDGE_URL` and `IMAGE_EDGE_SECRET`. Addresses become
   `https://img…/episodes/{id}/…?t=TOKEN`. A token names the episode, the user and an expiry and is signed
   with HMAC-SHA256. The Worker (`apps/edge-images`) rejects expired, tampered or wrong-episode tokens
   before touching its cache or the bucket, and caches the images at the edge. The reader code did not
   change. Deploying the Worker is a manual step (`wrangler.toml` is included; wrangler is not a project
   dependency).

### Watermarking

`WATERMARK_ENABLED=true` serves each paying subscriber a lossless copy of paid-episode chunks with their
user id hidden in the pixels (`/api/watermark`). Use it to trace a leak: `extractWatermark` in
`@inkline/shared` reads the id back. Limits: it survives only lossless copies (not JPEG, scaling or a
phone photo of the screen); the copies are bigger and cost CPU; and **watermarked images are made per
person, so they can never go through the edge cache or a CDN.** Off by default.

## Keeping the audit true

- A new route or server action must be added to the tables above, with all five columns, in the same pull request.
- `e2e/cross-user.spec.ts` must gain a case for any new per-user data.
- `pnpm audit --audit-level high` and gitleaks run in CI (`.github/workflows/ci.yml`); they need the repository on GitHub to run.
