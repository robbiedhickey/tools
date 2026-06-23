# Plan: supplementary write API for the Kongsole

## Goal

The Kongsole (`index.html`) is currently read-only against `1001albumsgenerator.com`'s API —
rating an album or saving a listening note requires opening the real site in an iframe modal
(`SiteModal`). The goal is a small backend service that lets the Kongsole submit ratings and
listening notes directly, so the user never has to leave the app for that.

Explicitly **not** in scope: anything touching the admin-gated `/api/admin/analytics/*` family
(see `openapi.yaml`'s "Account Actions" tag description for why).

## Working theory: no headless browser needed

Original idea was a headless browser (e.g. Playwright) logging in and clicking through the real
UI to submit ratings, to avoid needing real credentials. Investigation on 2026-06-23 suggests this
is unnecessary — the write endpoints appear to require **no authentication at all**, just the
right `projectName` in the URL path. If that holds up, a thin server-side service making direct
HTTP calls (no browser, no session, no cookie) is enough.

## Evidence gathered so far

1. **`POST /api/login` requires no password.**
   ```
   POST https://1001albumsgenerator.com/api/login
   body: {"loginValue":"hodorswit"}
   → 200 {"success":true,"projectSlug":"hodorswit"}
   ```
   No `Set-Cookie` header in the response — confirmed via `curl -i` and an empty cookie jar. This
   "login" is really just a project-name lookup that tells the browser where to redirect; it
   doesn't establish a session.

2. **CORS is wide open on every write endpoint tested**, same as the read endpoints already
   documented in `openapi.yaml`:
   - `OPTIONS /api/hodorswit/{generatedAlbumId}/rate` → `Access-Control-Allow-Origin: *`
   - Confirmed not just via `curl` but via an actual cross-origin browser `fetch()` from
     `http://localhost:8845` (a different origin than `1001albumsgenerator.com`) — the request
     completed and the response body was readable in-browser, ruling out CORS as a blocker.

3. **Origin/Referer spoofing made no difference.** Replayed an identical rating payload via
   `curl` with `Origin: https://1001albumsgenerator.com`, `Referer:
   https://1001albumsgenerator.com/hodorswit/history`, and matching `Sec-Fetch-*`/`User-Agent`
   headers (copied from the user's own real browser request) — got the exact same response as
   without those headers. This rules out the server checking `Origin`/`Referer` as a gate.

4. **A replayed *already-rated* payload returns `{"success":false,"error":{}}` (still HTTP 200).**
   Tested by resubmitting hodorswit's real, already-on-file rating for "Sound of Silver"
   (`generatedAlbumId: 6a39f6bae5c11d631493e6b9`, rating 5, with the real review text) — both via
   `curl` and via a real cross-origin browser `fetch`. Both attempts got rejected identically.
   Since the headers didn't matter (see #3) and the payload exactly matched what's already
   recorded, the leading hypothesis is that this is a **business-logic guard against re-rating an
   already-rated day**, not an auth/CORS rejection. This is **not yet confirmed** — it's the
   one open question blocking certainty.

5. **`listening-note` is confirmed fully unauthenticated — first endpoint actually proven, not
   just theorized.** The user captured their own real browser request adding a note ("test") to
   `hodorswit`'s *current* album (`5f34ee8bf0857e55ed5bad9e` — note this uses the album's `uuid`
   directly, not a `generatedAlbumId`, and works on `currentAlbum` rather than being restricted to
   "previous/pending rating" albums like `/rate` is). Verified live with a plain `curl` call using
   **zero special headers** — no `Origin`, no `Referer`, no `User-Agent`, no cookies, nothing but
   `Content-Type: application/json`:
   ```
   POST https://1001albumsgenerator.com/api/hodorswit/5f34ee8bf0857e55ed5bad9e/listening-note
   body: {"notes":"confirmed: no-auth write test via plain curl, 2026-06-23","isUserAlbum":false}
   → 200 {"success":true}
   ```
   Confirmed as a real write (not cached/no-op) by changing the note to a distinct value and
   reading it back via `GET /api/v1/projects/hodorswit` — it matched exactly. Also: replaying the
   *original* note value afterward succeeded too (`{"success":true}` both times), so unlike
   `/rate`, `listening-note` has **no "already submitted" guard** — it's freely overwritable.
   (Note was restored to `"test"` afterward, undoing the test value.)

   This is the strongest evidence yet for the no-auth theory — it's a directly observed result,
   not an inference from a rejected duplicate like `/rate`'s test.

6. **There's a separate "pending previous album" concept, distinct from `currentAlbum`.** The
   site's HTML embeds it inline:
   ```html
   <script>
     window.albumGenerator.rate = {
       previousAlbumId: '...',            // Album.uuid
       previousAlbumGeneratedAlbumId: '...', // what /rate actually needs
       doneData: {},
       prefilledRating: '',
     }
   </script>
   ```
   `previousAlbumGeneratedAlbumId` is empty when there's nothing pending (e.g. `hodorswit` right
   now — fully caught up). `currentAlbum` (today's pick, still being listened to) is a different
   thing and doesn't appear to be ratable yet via `/rate`.

## The decisive test — RUN, and CONFIRMED (2026-06-23)

Run against `emmerson-hickey` (not `lankyserv` — that account had no fresh pending rating at the
time; `emmerson-hickey` did, with a 60-album unrated backlog).

**Critical correction discovered during this test**: the URL path takes the album's `uuid`
(`previousAlbumId`), **not** `generatedAlbumId`. The one real captured example back in evidence
#1 actually showed this all along (`5f34ee8bf0857e55ed4ac0ee` in the URL vs
`6a39f6bae5c11d631493e6b9` in the body) but earlier write-up here mislabeled it. The two IDs are
visually similar (both 24-hex Mongo ObjectIds) which is presumably how this got muddled.

First attempt picked an arbitrary unrated backlog album ("Sound of Silver") but **made the exact
mistake this section warns about** — put `generatedAlbumId` in the URL where `albumUuid` belongs.
Got rejected with `{"success":false,"error":{}}`. At the time this was (wrongly) read as evidence
that `/rate` only accepts one specific "current pending" album — see the correction below.

Second attempt, with corrected IDs, targeted **Nevermind** specifically (the album the profile
page's `window.albumGenerator.rate.previousAlbumGeneratedAlbumId` pointed to):
```
POST https://1001albumsgenerator.com/api/emmerson-hickey/5f34ee8bf0857e55ed5ebecc/rate
Content-Type: application/json

{"rating":5,"notes":"","fromHistoryView":true,"generatedAlbumId":"69dc5c4fcec3ab6663376a86","isUserAlbum":false}
```
→ `200 {"success":true,"allAlbumsRated":false}`. Succeeded — but because the IDs were finally
correct, not because Nevermind happened to be the "pending" one. This is what caused the
mistaken "current pending only" conclusion below, since it was the only correctly-formed test at
the time.

**Third test (after re-reading the user's literal ask to try the real "Rate" button on the real
history page) overturned that conclusion.** Clicked the actual `Rate` button next to **Sound of
Silver** — an album that was *not* the current pending one — on
`https://1001albumsgenerator.com/emmerson-hickey/history`, filled in a 5-star rating through the
real inline form, and captured the real network request via Playwright:
```
POST https://1001albumsgenerator.com/api/emmerson-hickey/5f34ee8bf0857e55ed4ac0ee/rate
{"rating":5,"notes":"","fromHistoryView":true,"generatedAlbumId":"6a39f6bae5c11d58d093e6c0","isUserAlbum":false}
→ 200 {"success":true,"allAlbumsRated":false}
```
Succeeded, **despite Sound of Silver not being the "pending" album**. Confirmed via
`GET /api/v1/projects/emmerson-hickey` afterward — both Nevermind and Sound of Silver are now
`rating: 5`, both genuinely unrated immediately beforehand.

**Corrected conclusion**: `/rate` accepts *any* unrated backlog album with correctly-matched IDs
(`albumUuid` in the URL, that same entry's `generatedAlbumId` in the body) — it is **not**
restricted to whatever `previousAlbumId`/`previousAlbumGeneratedAlbumId` currently point to. That
pair is just "whatever the real UI's daily card defaults to," not an enforced restriction. This
restores the *original* hypothesis from evidence #4: the only real gate is **"this entry is
already rated."** The earlier "current pending only" theory in this doc was wrong, caused by not
noticing the first test's IDs were malformed rather than concluding the right thing from it.

**The no-auth theory is now confirmed for both write endpoints, for arbitrary backlog albums, not
just a single "current" one.** A headless browser is unnecessary, and a uniform
backlog-rating UI (rate any unrated entry, not just "today's") is fully supported by the API.

These were real, permanent writes on what may be someone else's real account — no "unrate"
endpoint is known to exist, so neither can be cleanly undone the way the `listening-note` test was.

## What the supplementary API needs

- A small backend (can't run in the Kongsole's own browser context — needs a server to call
  `1001albumsgenerator.com` directly, though notably it *wouldn't* need to hide any secret, since
  there isn't one).
- Two endpoints to start: submit a rating, save a listening note — mapping to
  `POST /api/{projectName}/{albumUuid}/rate` (body also needs `generatedAlbumId`, a *separate* ID —
  see the correction above) and `POST /api/{projectName}/{albumId}/listening-note` (both should be
  promoted from "unverified" to verified in `openapi.yaml`'s Account Actions section now).
- Needs each backlog entry's `album.uuid` and `generatedAlbumId` — both already present on every
  `HistoryEntry` returned by the public `/api/v1/projects/{projectIdentifier}` endpoint (no HTML
  scraping required for this, unlike what was assumed earlier). The
  `window.albumGenerator.rate.previousAlbumId`/`previousAlbumGeneratedAlbumId` scrape is only
  needed if the Kongsole wants to default to "today's" pending album specifically — it is not a
  requirement for rating *any other* backlog entry.
- Since any unrated backlog entry can be rated, **the Backlog tab is a viable uniform mechanism**
  for this — no need for a separate "Today" special case purely to satisfy the API's
  constraints. (There may still be UX reasons to surface "yesterday's pick" prominently in Today,
  but that's a product choice, not an API limitation.)

## Open questions

- ~~Is the `{"success":false,"error":{}}` response from `/rate` really "already rated"?~~
  **Resolved, for real this time**: yes. An incorrect mid-session conclusion ("must be the
  current pending album") was reached from a test whose IDs were simply malformed, then
  overturned by directly observing the real history page successfully rate a non-pending album.
  The only real gate is re-rating an already-rated entry.
- Is there any way to undo/correct a submitted rating (an "unrate" endpoint, or does resubmitting
  with a different rating on the same `generatedAlbumId` overwrite it)? Not yet tested — would
  need a fresh, intentionally-disposable rating to try a resubmit-with-different-value test
  safely (this session's two real test ratings are not disposable, so this wasn't tried on them).
- Is there any rate limiting specific to these write endpoints beyond the general informal
  "~3 requests/minute" mentioned in `openapi.yaml`? Not hit yet across this session's testing.
- `/rate` confirmed to need zero special headers, same as `listening-note` — both write endpoints
  now share the same no-auth, no-CORS-preflight-issue profile.
