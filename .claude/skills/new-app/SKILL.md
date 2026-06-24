---
name: new-app
description: Use when adding a new standalone app/project to this "tools" repo, or when giving an existing static-only app a backend. Covers the repo's static-site conventions, Cloudflare Pages deployment setup, Pages Functions structure, KV/D1 data store conventions, and local dev — so a new project follows the same pattern as 1001-albums instead of inventing a new one.
---

# Adding a new app to this repo

This repo (`robbiedhickey/tools`) is a generic dumping ground for small, mostly-independent
side projects — typically standalone static SPAs. The conventions below exist so that adding
project N+1 never requires touching project 1..N, and so a project can stay purely static for
as long as it wants and only pick up a backend the day it actually needs one.

## Hosting model (don't re-derive this, it's already true)

- Cloudflare Pages project `tools`, git-connected to this GitHub repo, auto-deploys on every
  push to `main`.
- Build configuration is intentionally empty: Framework preset `None`, no build command, output
  directory `/` (repo root). Cloudflare just copies the repo root as static assets. **Keep it
  this way** — don't introduce a bundler/build step for a new project unless you're prepared to
  also reconfigure the Pages build settings (and accept that it now affects every other project
  in the repo, since there's only one build config for the whole site).
- Custom domain `tools.robbiehickey.com` is served via this Cloudflare Pages project. DNS lives
  at Namecheap (not Cloudflare), as a CNAME to `tools-kbt.pages.dev`.
- `/_redirects` at the repo root uses Cloudflare's Netlify-compatible redirects syntax. Existing
  rules give each project's SPA routing a fallback to its own `index.html`. If a new project
  needs path-based (non-hash) deep links, add rules here scoped to that project's folder —
  don't touch other projects' rules.

## Static-only project (the default — start here)

Just add a new top-level folder, e.g. `/my-app/`, with whatever static files it needs
(`index.html`, etc.). That's the entire setup. No `/functions` entry, no config changes, no
build step. Most projects in this repo should stay exactly this simple.

Prefer vanilla JS / CDN-imported libraries (e.g. `https://esm.sh/...`, as `1001-albums/index.html`
does with Preact + htm) over anything requiring a local build step, since there isn't one.

### Link it from the root index

The root `/index.html` is a hand-maintained directory of every project — a new app isn't
discoverable until it's added there. Add one `<li>` to the existing list, following the
established pattern exactly:

```html
<li><a href="my-app/">My App</a> - One sentence describing what it does</li>
```

- `href` is the project's folder (e.g. `1001-albums/`) or a top-level `.html` file for
  single-file projects (e.g. `drum-patterns.html`) — match whichever shape the new project is.
- One sentence, no trailing period, dash-separated from the name (matches every existing entry).
- Not every `.html` file at the repo root is necessarily listed here (some are deliberately
  unlisted) — only add an entry if the project is meant to be publicly discoverable from the
  homepage.

## Giving a project a backend (only when it actually needs one)

### Functions folder mirrors the static folder

```
functions/
  <project-slug>/
    api/
      <route>.js              → GET/POST/etc. on /<project-slug>/api/<route>
      [param].js               → dynamic segment
    _lib/
      shared-helper.js          → NOT routed (underscore-prefixed dirs are excluded from routing)
```

A static-only project has no entry under `/functions` at all. The day a project needs a
backend, add exactly one new folder named after that project's static folder — never touch
another project's `/functions/<other-slug>/` folder.

Each route file exports `onRequestGet`, `onRequestPost`, `onRequestDelete`, etc. (standard Pages
Functions file-based routing). Relative imports between files are common — double check path
depth carefully (`functions/<slug>/api/foo/[id].js` importing from `functions/<slug>/_lib/x.js`
needs `../../_lib/x.js`, not more or fewer `../`s — this has bitten us before by being one level
off).

### Data store: KV is the default, reach for D1 only if you need relational queries

**KV (default choice):**
- One shared namespace across the whole repo, bound as `TOOLS_KV` — don't provision a new
  namespace per project, just start writing keys with a new prefix.
- Key convention: **`<project-slug>:<userKey>:<feature>`** — user/owner segment before the
  feature segment, so `list({ prefix: "<project-slug>:<userKey>:" })` can fetch everything for
  one user across every feature that project ever grows (favorites, notes, ratings, ...).
- Value size cap is 25MB — a blob-per-user-per-feature design is fine even into the thousands
  of items; don't shard into per-item keys preemptively. Only reach for a key-per-item scheme if
  concurrent-write clobbering on the same blob becomes a real problem.
- No schema, no migrations, nothing to keep in sync between local dev and production beyond the
  binding name itself.

**D1 (only if you actually need relational queries across rows):**
- Give the project its **own** D1 database (not shared) — migration history is a linear
  sequence, and interleaving unrelated projects' migrations in one history is a mess to untangle
  later. One DB per project that needs one keeps each project's schema history (and its
  eventual teardown) clean.
- Migrations live at `functions/<project-slug>/migrations/`.
- Automate applying them via the Pages **build command** (Settings → Builds & deployments):
  `npx wrangler d1 migrations apply <db-name> --remote` (chain multiple projects' migrations
  with `&&` if more than one project has D1). Requires `CLOUDFLARE_API_TOKEN` (scoped to D1
  edit) and `CLOUDFLARE_ACCOUNT_ID` set as encrypted environment variables on the Pages project
  — set these once, not per project.
- This is real ceremony (migrations folder, build command, token) that KV doesn't have. Don't
  reach for D1 by default — only when the data genuinely needs joins/filters across rows that a
  KV prefix-list can't express reasonably.

### Wiring up a new binding (KV namespace, D1 database, env var)

Two places need it, and they don't auto-sync:
1. **Production** — Cloudflare dashboard → Pages project `tools` → Settings → Functions →
   Bindings (or via the Cloudflare API/wrangler against the *account*, e.g.
   `wrangler kv namespace create <name>` then a Pages API `PATCH` of
   `deployment_configs.production`/`.preview` — see git history around the favorites feature
   for the exact calls used last time).
2. **Local dev** — add the same binding to the repo's `wrangler.toml`.

## Local dev

- `npm run dev` → `wrangler pages dev` — full stack: static assets + Pages Functions + a
  locally-emulated KV store, using the bindings declared in the repo's `wrangler.toml`. Local KV
  data persists in `.wrangler/state` (gitignored) and is completely separate from production
  data — safe to test destructively.
- `npm run dev:static` → plain `serve .`, no Functions/KV at all. Use this if you only need to
  look at static markup/styling and don't care about backend routes.
- `wrangler.toml` at the repo root is **local-dev only** — Cloudflare Pages' git-integration
  deploy ignores it entirely and uses the dashboard-configured bindings instead. When you add a
  binding for production, mirror it in `wrangler.toml` too, or local dev won't have it.

## Checklist for adding a new app

1. New folder (or single `.html` file) at repo root, static files in it.
2. Add a one-line `<li>` entry for it on the root `/index.html`, matching the existing format.
3. Need SPA path routing? Add scoped rules to `/_redirects`.
4. Need a backend? Add `functions/<slug>/api/...`. Default to KV with the shared `TOOLS_KV`
   binding and the `<slug>:<userKey>:<feature>` key convention. Only use D1 (own database,
   own migrations folder, build-command automation) if you genuinely need relational queries.
5. Any new binding goes in both the Cloudflare dashboard (production/preview) and
   `wrangler.toml` (local dev).
6. Push. Most projects stop at step 2.
