---
name: test-locally
description: Use when you need to actually run and click through an app in this repo (e.g. to verify a change, do a design/UX review, or debug behavior) rather than just reading the code. Covers starting the shared local dev server without port conflicts, and per-project notes for logging into apps that need a real account — e.g. 1001-albums needs a live username, not a mock.
---

# Testing apps in this repo locally

This repo serves every project from one shared Cloudflare Pages dev server — there's no
per-project dev command.

## Starting the server

```
npm run dev          # wrangler pages dev — full stack: static + Pages Functions + local KV
npm run dev:static    # serve . — static files only, no Functions/KV
```

Before starting one, check whether it's already running — `npm run dev` binds port 8788, and a
second instance will fail with `Address already in use` instead of just reusing the existing one:

```
lsof -i :8788 -P -n
```

If something's already listening there, just hit it directly (`http://127.0.0.1:8788/<project>/`)
rather than spawning a duplicate server.

Local KV data lives in `.wrangler/state` (gitignored), fully separate from production — safe to
mutate destructively.

## Driving the app

Use the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`,
`browser_click`, etc.) against `http://127.0.0.1:8788/<project>/` to actually exercise the UI —
don't infer behavior from source alone when a visual or interaction question is in play.

## Per-project login notes

### 1001-albums

There's no mock/demo mode — the app requires a real `1001albumsgenerator.com` username and fetches
that user's live data on every load. Known accounts with populated data (see
`1001-albums/WRITE_API_PLAN.md` for how these were discovered/used during API work):

- `hodorswit` — caught up, small/empty backlog, has group history with other members
  (`clutchy`, `emmerson-hickey`, `lankyserv`, ...). Good for Today/Group/Me/Activity views.
- `emmerson-hickey` — large (60+) unrated backlog. Good for testing the Backlog view with real
  volume instead of 0-1 rows.

Enter the username on the landing screen (`/1001-albums/#/`) and submit — it routes to
`#/<username>/today` and remembers it for next time via the same browser's storage.
