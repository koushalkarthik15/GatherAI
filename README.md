# GatherAI — Event Studio

A workspace for planning single-day college and community events: tasks, budgets, resources, schedules and reviewed AI suggestions.

## What runs

- **Local demo:** sample events with edits saved in the current browser. No account, API or provider credentials required. AI previews in this mode are simulated.
- **Saved workspace:** email/password accounts, owner-isolated events, autosave, reviewed AI additions, directory searches and deterministic funding/date/attendance proposals.
- **Stack:** React/Vite/TypeScript, Fastify, shared planning rules, Supabase Auth/Postgres and a bounded LangGraph generation workflow.

AI runs only on explicit requests. Proposals are stored separately and applied after review with revision checks. Existing IDs, edits, completed tasks, spending and commitments are protected. Estimates and directory results are not confirmed prices or bookings. Pending funding is excluded from available funds.

## Problem, scope and approach

College clubs and community organizers often coordinate tasks, supplier leads and costs in separate tools. GatherAI keeps these decisions in one editable plan, distinguishing estimates, actual spending, confirmed funding and pending funding.

The scope is **single-day college and community events**. Organizers can adjust attendance, dates and funding, review proposed changes, manage task dependencies, compare shortlisted resources and finalize their own selections. GatherAI does not make bookings, contact suppliers or verify organizer-entered confirmations.

- **Deterministic planning:** budgets, task ordering, dependencies, scenarios and revision checks run as ordinary TypeScript functions without AI calls.
- **Reviewed generation:** Groq and Gemini supply structured suggestions through a bounded LangGraph workflow. Suggestions remain proposals until reviewed and applied. Business listings come from directory providers, not generated names.

## Architecture and source map

| Layer | Responsibility | Implementation |
|---|---|---|
| Workspace UI | Select demo/account mode and load features | [StudioApp.tsx](apps/web/src/StudioApp.tsx), [features](apps/web/src/features) |
| Workspace contract | Explicit interface shared by demo and account storage | [studio.ts](apps/web/src/state/studio.ts) |
| Demo persistence | Validate browser data, retain undo history, pause saving after load failure | [useStudio.ts](apps/web/src/state/useStudio.ts) |
| Account persistence | Queue event saves, track revisions, retain failed drafts for retry | [useCloudStudio.ts](apps/web/src/cloud/useCloudStudio.ts), [API client](apps/web/src/cloud/api.ts) |
| Shared domain | Schemas, financial rules, planning transformations and generated-output validation | [core source](packages/core/src) |
| HTTP boundary | Authenticate, validate inputs, restrict CORS and return safe errors | [buildApp.ts](apps/api/src/buildApp.ts), [repository.ts](apps/api/src/repository.ts) |
| AI orchestration | Reserve proposals, bound attempts, validate and store suggestions | [routes.ts](apps/api/src/ai/routes.ts), [workflow.ts](apps/api/src/ai/workflow.ts), [providers.ts](apps/api/src/ai/providers.ts) |
| Directory search | Geocode, query providers, filter results, bound responses and cache searches | [directory.ts](apps/api/src/sourcing/directory.ts), [client.ts](apps/api/src/sourcing/client.ts), [gate.ts](apps/api/src/sourcing/gate.ts) |
| Database | Authenticated RPCs, ownership policies, revision checks and shared reservations | [fresh-install SQL](GatherAI_database_setup.sql) |
| Serverless adapter | Forward Node requests to Fastify without opening a listening socket | [entrypoint](apps/api/api/index.ts), [serverless.ts](apps/api/src/serverless.ts) |

The browser sends the signed-in user's bearer token to Fastify. The API validates the session with Supabase Auth and retains that token for database RPCs; it does not substitute an administrator credential. Provider credentials stay on the server. Directory and AI provider requests originate in the API.

### AI proposal lifecycle

1. The organizer explicitly requests suggestions for a saved event revision.
2. The API checks authentication, event access and revision before reserving a proposal. Reservations support retry/idempotency handling and daily quotas.
3. LangGraph invokes the primary provider with bounded event context and a JSON response schema. Transient failures can switch providers; invalid output can trigger regeneration. Authentication/configuration failures stop. **All paths share a maximum of two provider attempts**, not two attempts per provider.
4. Shared validation checks structure and planning constraints, then assigns application IDs. Provider envelopes, completion status and response sizes are checked separately.
5. The proposal is stored separately from the event. The organizer reviews, applies or discards it using revision checks. Rollback is conditional, rather than overwriting subsequent edits unconditionally.

### Planning rules and tradeoffs

- Money uses integer INR minor units: **100 = ₹1**.
- Available funding is the smaller of confirmed funding and the organizer's budget limit. Pending funding is excluded.
- Cost exposure sums the larger of estimate and actual spending for each budget item. Remaining funds equal available funding minus exposure. See [rules.ts](packages/core/src/rules.ts).
- Generated additions must fit remaining funds and pass shared validation. Existing organizer edits, actual spending and commitments are protected by the proposal/apply workflow.
- External responses are untrusted. Timeouts, response-size bounds and schemas limit failure handling; retries are bounded.
- Directory caches reduce repeat requests but may be stale. Supplier suitability, availability and prices require independent confirmation.
- Demo mode is a credential-free review path using browser storage and simulated AI previews. It does not demonstrate live generation or account isolation.

## API overview

Except for health, these routes require a bearer session. Event operations additionally enforce access. Schemas live with routes and shared core types.

| Method and route | Purpose | Important condition |
|---|---|---|
| `GET /health` | Process health | Does not probe database/provider readiness |
| `GET /api/events` | List saved events | Account-scoped access |
| `POST /api/events` | Create an event | UUID `Idempotency-Key` header |
| `GET /api/events/:id` | Read an event | Accessible event UUID |
| `PUT /api/events/:id` | Save a plan | Matching ID, operation ID and expected revision |
| `GET /api/ai/status` | Report AI configuration | Both provider keys and model names required to enable generation |
| `POST /api/events/:id/generate` | Generate a proposal | Operation ID, revision and quota reservation |
| `GET /api/events/:id/proposals` | List proposals | Event access |
| `POST /api/events/:id/proposals/:proposalId/:action` | Apply, discard or roll back | Supported action and expected revision |
| `POST /api/events/:id/venues` | Search venue, food or equipment leads | Enabled directory; Geoapify for food/equipment |

Validation errors use 400, missing authentication 401, denied access 403, missing records 404, revision conflicts 409, and applicable quota failures 429. Dependency failures use safe codes instead of forwarding provider payloads. Request IDs support diagnosis; logs are designed to omit credentials and request bodies. See [logging.ts](apps/api/src/logging.ts).

## Install and run the demo

Use Node.js 22.12+ and npm. From the repository root:

```powershell
npm ci
npm run dev
```

If a clean install reports a missing Rollup/esbuild native package, run `node scripts/repair-lockfile.mjs`, then `npm ci`. The repair resolves dependencies in a temporary directory without an old lockfile or installed modules, validates native entries for Linux/macOS/Windows, and retains a backup of the original lockfile. It may update versions within the manifest ranges; review the printed changes and lockfile diff, then rerun checks before committing.

Open http://localhost:5173. Leave browser Supabase variables unset to stay in demo mode. For saved workspaces, complete the setup below first.

## New database and authentication setup

1. Create a new Supabase project dedicated to this installation.
2. In its SQL Editor, run the entire [GatherAI_database_setup.sql](GatherAI_database_setup.sql) once as the project database administrator. It includes the complete application schema, indexes, access policies and functions through October 28, 2026. It assumes Supabase's built-in Auth schema and roles; it is not a standalone PostgreSQL installer.
3. The script runs in one transaction and rejects an existing Gather installation. Do not run it on the original configured project or use it to upgrade an existing installation. It creates no accounts or sample events, imports no user data, and does not register Supabase CLI migration history. Historical migrations are maintained locally; this file is the repository's fresh-install snapshot.
4. Keep `public` exposed through the Data API and keep `private` unexposed. The application uses authenticated RPCs; do not enable direct table writes to resolve a setup error.
5. Enable email/password sign-in and email confirmation. Set the Auth Site URL to `http://localhost:5173` and allow that URL for redirects. Use the same hostname consistently. For deployment, update these to your web origin and allow its authentication redirects.
6. Configure email delivery for intended users. If confirmation or password-reset delivery is restricted, configure SMTP rather than disabling confirmation to hide the issue.

The SQL file does not configure dashboard Auth settings, SMTP, hosting, API keys or billing. Those steps remain manual. Its fresh-install execution has not yet been verified against a new Supabase project.

## Environment configuration

Copy the committed examples once; do not overwrite existing configured files:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.env.example apps/api/.env
```

Use the same Supabase project URL and publishable key in both files. A legacy anon key is also supported. Never use a Supabase service-role/secret key in the browser; this application does not require one in the API either. Actual environment files are ignored by Git.

| File | Variable | Value/purpose |
|---|---|---|
| `apps/web/.env.local` | `VITE_SUPABASE_URL` | Your Supabase project HTTPS URL. |
| `apps/web/.env.local` | `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's browser-public publishable key. |
| `apps/web/.env.local` | `VITE_API_URL` | Leave empty locally: Vite proxies `/api` to port 3001. Set to the API HTTPS origin for deployment. |
| `apps/api/.env` | `SUPABASE_URL` | Same project URL. |
| `apps/api/.env` | `SUPABASE_PUBLISHABLE_KEY` | Same publishable key; requests retain the signed-in user's token. |
| `apps/api/.env` | `WEB_ORIGIN` | `http://localhost:5173` locally; exact web origin for deployment. |
| `apps/api/.env` | `HOST`, `PORT` | Local defaults: `127.0.0.1`, `3001`. |
| `apps/api/.env` | `GROQ_API_KEY`, `GEMINI_API_KEY` | Server-only AI credentials. Both keys are required to enable account-workspace generation; optional for manual planning. |
| `apps/api/.env` | `GROQ_MODEL`, `GEMINI_MODEL` | Model IDs accessible to your account; example values are configurable and availability is not guaranteed. |
| `apps/api/.env` | `AI_PRIMARY_PROVIDER` | `groq` or `gemini`; configured fallback is bounded. |
| `apps/api/.env` | `GEOAPIFY_API_KEY` | Server-only directory credential for venue, food and equipment searches. Required for food/equipment. |
| `apps/api/.env` | `DIRECTORY_ENABLED` | Set `true` to enable or `false` to disable; omitted defaults to enabled. |

Never put provider keys in `VITE_*` variables. Manual saved-event operations do not require AI credentials. Without Geoapify, the legacy public venue lookup path may be available, but food and equipment searches require Geoapify; review provider policies and availability before enabling directory lookup in production.

Restart the API after changing its environment. Rebuild the web app after changing production `VITE_*` values.

## Run saved workspaces locally

Start these in separate terminals from the root:

```powershell
npm run dev:api
```

```powershell
npm run dev
```

Open http://localhost:5173. The health endpoint is http://127.0.0.1:3001/health; it confirms the API process is running, not that the database or AI provider is working.

Smoke-test a new installation: sign up, confirm the email, sign in, create an event, edit a task, wait for saving, reload and confirm the edit persists. A second account must not see the first account's events. If AI is configured, explicitly generate, review and apply a proposal; no generation is necessary for manual planning.

If `/api` reports connection refused, check the separate API terminal and restart it. If saving fails, keep the tab open and retry; reloading can discard an unsaved draft. A stale-revision conflict requires reviewing/reloading the saved version rather than forcing an overwrite.

## Checks

```powershell
npm test
npm run test:api
npm run typecheck
npm run lint
npm run build
npm run test:api:build
npx playwright install chromium
npm run test:e2e
```

Core and API tests use fixtures without real AI spending. `npm run build` builds both the web frontend and API JavaScript. `npm run test:api:build` then loads the compiled serverless API handler without TypeScript runtime flags and checks health, authentication rejection and CORS using synthetic settings. The source API tests also cover JSON request bodies through the handler. Playwright covers selected demo interactions, including task edit/undo/reload and keyboard focus restoration; it does not establish full saved-workspace or provider coverage.

For database regression tests, install PostgreSQL client tools (`psql` on PATH), initialize a **disposable Supabase database** using the setup script and create a confirmed test account. Set `GATHER_TEST_DATABASE_URL` privately in your terminal to that database's administrator connection string, then run:

```powershell
npm run test:db
```

The four SQL scripts run in rollback-only transactions and cover generation, quotas, reviewed proposals and the directory gate. They select an existing test account; do not point this runner at production. Never commit its connection string.

For production performance checks:

```powershell
npm run build
npm run preview
```

Open http://127.0.0.1:4173 and use Lighthouse Navigation with consistent device/throttling and account state. Development-server scores include development tooling and are not release performance measurements. Keep the API running separately for saved flows.

## GitHub Actions and Vercel

The workflow runs typecheck, lint, fixture tests, production web/API builds, compiled-handler checks and Playwright on pushes and pull requests. Both jobs use `npm ci` with the committed cross-platform lockfile; no ad hoc native-package installation is required. It never applies database changes. Manual runs on `main` can stage the web and API after checks pass, without assigning production domains. No automatic promotion is configured.

1. Use two Vercel projects for this repository. Web Root Directory: repository root, framework Vite. API Root Directory: `apps/api`, framework Other (`null` in its Vercel config). Enable source files outside the API Root Directory for `packages/core`. The API installs from the workspace root and exposes `api/index.ts` as an explicit Node request handler; catch-all rewrites keep the existing Fastify routes. Its static Output Directory is `public`, containing only the API crawler policy; the Node function is built separately from `api/index.ts`. It does not open a listening socket in the serverless function. Local `npm run dev:api` continues to use `src/index.ts` as a listening server. The committed Vercel configs define build and routing.
2. The workflow defaults to this repository's existing Vercel team and separate web/API project IDs, with CLI pinned to `65.4.0`. For another account/project or CLI version, override `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` for web, `VERCEL_API_ORG_ID` and `VERCEL_API_PROJECT_ID` for API, and `VERCEL_CLI_VERSION` (exact `x.y.z`) using GitHub variables or `production` environment secrets. Secrets take precedence over variables, followed by the committed defaults. Store `VERCEL_TOKEN` in the GitHub `production` environment secrets. Configure required reviewers and restrict that environment to `main`.
3. Configure API environment values from the table above. Keep all provider credentials server-only. Set `WEB_ORIGIN` to the exact frontend origin; preview origins need deliberate configuration.
4. Configure web `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_API_URL` with the deployed API HTTPS origin. Update Supabase Auth URLs for the web origin. Web environment values are embedded at build time.
5. When deploying a fork or changing Supabase/API origins, update the frontend's `connect-src` allowlist in [vercel.json](vercel.json). It permits the current production origins, Google Fonts and local assets. Copying it unchanged to different origins can block authentication and API requests.
6. In Actions, select Run workflow on `main` with `stage_api` and/or `stage_web`. Establish the API URL first. Inspect and smoke-test each staged deployment, including `/health`, sign-in, saving and directory search, before separately promoting each in Vercel.

The GitHub Actions deployment jobs are manual, but Vercel's separate Git integration can automatically deploy pushes. Do not treat manual Actions inputs as disabling that integration. Vercel runtime behavior, cross-origin authentication and provider calls still require verification after the maintainer deploys these local changes; local build results do not prove a healthy deployed API.

## Limits and verification status

Generation allows at most two provider attempts per explicit request, with server-side schema/semantic checks and daily reservations of five requests per account and twenty per project (UTC reset); failed requests count. Application limits do not guarantee provider pricing or account allowances.

The shared directory gate has a daily cap, cooldown and expiring lease. An authenticated lease owner can release its own lease directly, so concurrency is not resistant to a deliberately modified client. Directory results and organizer-entered confirmations are not supplier guarantees.

The October 30 local verification passed 29 core tests, 35 API tests (including two directory-client regressions), typecheck, lint, the combined web/API build and the compiled API handler check. Both Playwright demo tests reported passing assertions using installed Chrome; runner shutdown stalled and was interrupted, so that run did not complete with a clean success exit. These results do not establish live provider behavior, complete saved-workspace browser coverage or a fresh execution of the consolidated database script.

Four database scripts previously passed against the configured project in rollback-only transactions; they were not rerun for the code-quality refactor. The previously recorded mobile Lighthouse result was 91 performance and 100 accessibility: a historical single-run measurement, not a current release guarantee. Bundle-size and Zod annotation build warnings remain.

### Coverage map

| Verification | Evidence | What it does not establish |
|---|---|---|
| Domain rules | [Core tests](packages/core/test): budgets, scenarios, dependencies, proposals and shortlists | Browser behavior or real provider accuracy |
| API behavior | [API tests](apps/api/test): auth/ownership fixtures, revisions, generation limits, provider failures and directory behavior | Live database policies or external availability |
| Browser interactions | [Demo tests](tests/e2e/demo.spec.ts): editing, reload, undo and focus restoration | Full authenticated flow, browser matrix or complete accessibility compliance |
| Compiled runtime | [Handler check](scripts/test-api-build.mjs): health 200, unauthorized 401, CORS 204 | Vercel packaging or production configuration |
| Database regressions | [SQL tests](supabase/tests), [runner](scripts/test-db.mjs) | Fresh-install execution of the full snapshot or production migration safety |

These are bounded checks, not claims of 100% coverage. No coverage percentage or future evaluation score is asserted.

## Repository contents

Keep application source, lockfile, environment examples, tests, CI, Vercel configuration and `GatherAI_database_setup.sql` in the repository. Private project notes, historical migration files, the old M2 setup guide, historical sourcing SQL, local CLI state, generated reports and actual credentials are excluded. Work directly in the local `main` branch for this single-maintainer project. Do not create branches or PRs unless requested; verify locally before the maintainer pushes or deploys. Code indentation uses tabs.
