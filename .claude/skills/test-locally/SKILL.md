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

If the bug appears Safari/WebKit-specific, also use Safari WebDriver. Remote automation is enabled
on this Mac:

```
safaridriver -p 4444
```

Use WebDriver for computed geometry, scroll, fixed-position, and visual-viewport checks in real
macOS Safari. Keep Playwright MCP for the fast general click-through/screenshot workflow. For
installed iOS PWA issues, see the `ios-pwa-testing` skill; Safari desktop is only an intermediate
signal.

### Safari WebDriver recipe

Start safaridriver in the background, then drive it with Python's stdlib `urllib` — no extra
packages needed:

```bash
pkill -f safaridriver 2>/dev/null; safaridriver -p 4444 &
sleep 2
curl -s http://localhost:4444/status   # should return {"value":{"ready":true,...}}
```

```python
import json, time, base64, urllib.request

BASE = "http://localhost:4444"

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read())

# Open Safari at mobile viewport
sess = req("POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "safari"}}})
sid = sess["value"]["sessionId"]

req("POST", f"/session/{sid}/window/rect", {"width": 390, "height": 844, "x": 0, "y": 0})
req("POST", f"/session/{sid}/url", {"url": "http://127.0.0.1:8788/1001-albums/#/hodorswit/today"})
time.sleep(3)  # wait for JS app to render

# Measure layout geometry
result = req("POST", f"/session/{sid}/execute/sync", {
    "script": """
        var a = document.querySelector('.some-element').getBoundingClientRect();
        var b = document.querySelector('.other-element').getBoundingClientRect();
        return {
            aTop: a.top, aHeight: a.height,
            bTop: b.top, bHeight: b.height,
            sameRow: Math.abs(a.top - b.top) < 20   // within 20px = same flex row
        };
    """,
    "args": []
})
print(result["value"])

# Screenshot
ss = req("GET", f"/session/{sid}/screenshot")
with open("/tmp/safari.png", "wb") as f:
    f.write(base64.b64decode(ss["value"]))

req("DELETE", f"/session/{sid}")
```

**Key checks to run in Safari that Playwright/Chromium often misses:**
- `getBoundingClientRect()` on flex children to verify same-row layout (compare `.top` values)
- `window.innerHeight` vs `document.documentElement.clientHeight` for visual-viewport bugs
- `getComputedStyle(el).getPropertyValue('padding-bottom')` for safe-area-inset rendering
- Fixed-position elements: verify `.bottom` and `.top` are sane after scroll

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
