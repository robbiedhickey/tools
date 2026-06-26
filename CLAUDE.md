# tools.robbiehickey.com

Personal monorepo of tools and apps. Deployed on Cloudflare Pages (auto on push to main).

Live at: https://tools.robbiehickey.com

## Apps

Apps typically start as a single static HTML file at the root and grow into something stateful with a backend as needed.

| App | Entry | Stage |
|-----|-------|-------|
| 1001-albums | `1001-albums/` | Full app — Preact SPA, Pages Functions API, KV storage, push Worker |
| Chord Progressions | `chord-progressions.html` | Static |
| Drum Patterns | `drum-patterns.html` | Static |
| Dankcoin Capital Recovery Services | `dankcoin-capital-recovery-services.html` | Static |

When a static app outgrows a single file, the pattern is:
1. Move it to its own directory (`my-app/index.html`)
2. Add API routes under `functions/my-app/api/`
3. Add KV helpers under `functions/my-app/_lib/`
4. Add Workers under `workers/my-app/` if you need cron or background jobs

## Structure

```
chord-progressions.html   # Static apps — single file, no backend
drum-patterns.html
...
1001-albums/              # Graduated app — own directory, full stack
functions/                # Cloudflare Pages Functions (API routes), auto-deployed with Pages
  1001-albums/            # API backend for 1001-albums
    _lib/                 # Shared helpers (underscore = excluded from routing)
    api/                  # Route handlers
workers/                  # Standalone Cloudflare Workers — must be deployed manually
  1001-albums/            # Workers scoped to 1001-albums
    push-cron/            # Push notification cron worker
```

New features for 1001-albums go in:
- **Frontend**: `1001-albums/index.html` (single file, no build step)
- **API endpoints**: `functions/1001-albums/api/<route>/[projectName].js`
- **Shared KV helpers**: `functions/1001-albums/_lib/`
- **Background jobs / cron**: `workers/1001-albums/<name>/`

## Deployment

**Pages (frontend + functions):** Auto-deploys on push to main via Cloudflare git integration. No action needed.

**Workers:** Manual deploy — only `workers/1001-albums/push-cron/` exists today:
```bash
cd workers/1001-albums/push-cron && npx wrangler deploy
```
See that directory's README for secrets and key rotation.

## Key constraints

- `1001-albums/index.html` is **no-build**: ESM imports via esm.sh, no npm, no bundler. Add dependencies as esm.sh imports.
- KV binding is `TOOLS_KV` (id `e4257701cfa34e85bdacd76315317062`). Key shape: `1001-albums:<projectName>:<feature>` for per-user data, `1001-albums:push:<username>` for push subscriptions.
- Pages Functions cannot run cron — use a standalone Worker for scheduled jobs.
- The root `wrangler.toml` is for local dev only (`npm run dev`). Prod Pages bindings are dashboard-managed.

## Local dev

```bash
npm run dev   # Cloudflare Pages local dev on port 8788 (functions + KV emulation)
```
