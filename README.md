# tools.robbiehickey.com

Personal collection of small web tools, experiments, and utilities. Most tools are plain HTML and JavaScript; larger apps graduate into their own directories with Cloudflare Pages Functions, KV storage, or standalone Workers when they need backend behavior.

Live site: https://tools.robbiehickey.com

## What's inside

| Tool | Entry point | Notes |
| --- | --- | --- |
| 1001 Albums Kongsole | [`1001-albums/`](1001-albums/) | Companion dashboard for 1001albumsgenerator.com groups, including album links, backlog views, group stats, favorites, and push-notification support. |
| Chord Progressions | [`chord-progressions.html`](chord-progressions.html) | EP-133 scale and chord voicing reference with audio playback and arpeggio modes. |
| Pattern Lab | [`drum-patterns.html`](drum-patterns.html) | Interactive drum-pattern explorer with 160+ patterns from Pocket Operations. |
| Dankcoin Capital Recovery Services | [`dankcoin-capital-recovery-services.html`](dankcoin-capital-recovery-services.html) | Static microsite/utility. |

## Repository layout

```text
.
├── *.html                         # Single-file static tools
├── 1001-albums/                   # Larger Preact app, served as static assets
├── functions/1001-albums/         # Cloudflare Pages Functions for 1001 Albums APIs
├── workers/1001-albums/push-cron/ # Standalone Cloudflare Worker for push notifications
├── docs/                          # Design and implementation notes
├── wrangler.toml                  # Local Cloudflare Pages dev configuration
└── package.json                   # Local development and data-pipeline scripts
```

## Local development

Install dependencies, then run the Cloudflare Pages dev server:

```bash
npm ci
npm run dev
```

That starts `wrangler pages dev` for the static site plus Pages Functions. For a lightweight static-only server, run:

```bash
npm run dev:static
```

## Useful scripts

The root `package.json` includes scripts for the 1001 Albums data pipeline:

```bash
npm run tracks:fetch
npm run tracks:kv:build
npm run tracks:kv:validate
```

Some pipeline scripts use `uv` to run Python tools with their required packages. Remote KV writes and Worker deploys require Cloudflare credentials and should only be run intentionally.

## Deployment

- Cloudflare Pages deploys the main site and Pages Functions from the GitHub repository.
- Standalone Workers under `workers/` are deployed separately. See [`workers/1001-albums/push-cron/README.md`](workers/1001-albums/push-cron/README.md) for push-cron deployment notes, secrets, and key rotation.

## Adding a new tool

Most new tools can start as a single HTML file at the repository root and be linked from [`index.html`](index.html). If a tool grows beyond static assets, move it into its own directory and add supporting Pages Functions or Workers as needed.
