# Gather - Event Studio

A workspace for planning single-day college and community events: tasks, budgets, resources, schedules and reviewed AI suggestions.

## What runs

- **Local demo:** sample events with edits saved in the current browser. No account, API or provider credentials required. AI previews in this mode are simulated.
- **Saved workspace:** email/password accounts, owner-isolated events, autosave, reviewed AI additions, directory searches and deterministic funding/date/attendance proposals.
- **Stack:** React/Vite/TypeScript, Fastify, shared planning rules, Supabase Auth/Postgres and a bounded LangGraph generation workflow.

AI runs only on explicit requests. Proposals are stored separately and applied after review with revision checks. Existing IDs, edits, completed tasks, spending and commitments are protected. Estimates and directory results are not confirmed prices or bookings. Pending funding is excluded from available funds.

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
| `apps/api/.env` | `GROQ_API_KEY`, `GEMINI_API_KEY` | Optional server-only AI credentials; configure the provider(s) you intend to use. |
| `apps/api/.env` | `GROQ_MODEL`, `GEMINI_MODEL` | Model IDs accessible to your account; example values are configurable and availability is not guaranteed. |
| `apps/api/.env` | `AI_PRIMARY_PROVIDER` | `groq` or `gemini`; configured fallback is bounded. |
| `apps/api/.env` | `GEOAPIFY_API_KEY` | Optional server-only directory credential for venue and food searches. |
| `apps/api/.env` | `DIRECTORY_ENABLED` | Optional `false` to disable directory searches. |

Never put provider keys in `VITE_*` variables. Manual saved-event operations do not require AI credentials. Without Geoapify, the legacy public venue lookup path may be available, but food search requires Geoapify; review provider policies and availability before enabling directory lookup in production.

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

The workflow runs typecheck, lint, fixture tests, a production web build and Playwright on pushes and pull requests. Both jobs use `npm ci` with the committed cross-platform lockfile; no ad hoc native-package installation is required. It never applies database changes. Manual runs on `main` can stage the web and API after checks pass, without assigning production domains. No automatic promotion is configured.

1. Use two Vercel projects for this repository. Web Root Directory: repository root, framework Vite. API Root Directory: `apps/api`, framework Other (`null` in its Vercel config). Enable source files outside the API Root Directory for `packages/core`. The API installs from the workspace root and exposes `api/index.ts` as an explicit Node request handler; catch-all rewrites keep the existing Fastify routes. Its static Output Directory is `public`, containing only the API crawler policy; the Node function is built separately from `api/index.ts`. It does not open a listening socket in the serverless function. Local `npm run dev:api` continues to use `src/index.ts` as a listening server. The committed Vercel configs define build and routing.
2. The workflow defaults to this repository's existing Vercel team and separate web/API project IDs, with CLI pinned to `65.4.0`. For another account/project or CLI version, override `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` for web, `VERCEL_API_ORG_ID` and `VERCEL_API_PROJECT_ID` for API, and `VERCEL_CLI_VERSION` (exact `x.y.z`) using GitHub variables or `production` environment secrets. Secrets take precedence over variables, followed by the committed defaults. Store `VERCEL_TOKEN` in the GitHub `production` environment secrets. Configure required reviewers and restrict that environment to `main`.
3. Configure API environment values from the table above. Keep all provider credentials server-only. Set `WEB_ORIGIN` to the exact frontend origin; preview origins need deliberate configuration.
4. Configure web `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_API_URL` with the deployed API HTTPS origin. Update Supabase Auth URLs for the web origin. Web environment values are embedded at build time.
5. In Actions, select Run workflow on `main` with `stage_api` and/or `stage_web`. Establish the API URL first. Inspect and smoke-test each staged deployment, including `/health`, sign-in, saving and directory search, before separately promoting each in Vercel.

The GitHub Actions deployment jobs are manual, but Vercel's separate Git integration can automatically deploy pushes. Do not treat manual Actions inputs as disabling that integration. Vercel runtime behavior, cross-origin authentication and provider calls still require verification after the maintainer deploys these local changes; local build results do not prove a healthy deployed API.

## Limits and verification status

Generation allows at most two provider attempts per explicit request, with server-side schema/semantic checks and daily reservations of five requests per account and twenty per project (UTC reset); failed requests count. Application limits do not guarantee provider pricing or account allowances.

The shared directory gate has a daily cap, cooldown and expiring lease. An authenticated lease owner can release its own lease directly, so concurrency is not resistant to a deliberately modified client. Directory results and organizer-entered confirmations are not supplier guarantees.

Local checks on October 29 passed 29 core tests, 33 API tests, typecheck, lint, the combined web/API build and the compiled API handler smoke check. The latest saved Playwright run reports passed with no failed tests, matching the maintainer's terminal report. Four database scripts previously passed against the configured project in rollback-only transactions. These results do not prove a fresh install of the consolidated database script or the current Vercel runtime. The latest saved mobile Lighthouse report scored 91 performance and 100 accessibility; these are single-run measurements, not universal guarantees. Existing bundle-size and Zod annotation build warnings remain.

## Repository contents

Keep application source, lockfile, environment examples, tests, CI, Vercel configuration and `GatherAI_database_setup.sql` in the repository. Private project notes, historical migration files, the old M2 setup guide, historical sourcing SQL, local CLI state, generated reports and actual credentials are excluded. Work directly in the local `main` branch for this single-maintainer project. Do not create branches or PRs unless requested; verify locally before the maintainer pushes or deploys. Code indentation uses tabs.
