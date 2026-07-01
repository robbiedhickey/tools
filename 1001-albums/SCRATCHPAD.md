# Scratchpad — what's next

## Shipped (2026-07-01)
- Split the single-file app into ES modules (`lib/`, `components/`, `app.js`) loaded via import map + `modulepreload`.
- Added `_headers` + SW stale-while-revalidate caching for the multi-file load.
- Deferred the per-group-member `/projects/:name` fetch to Group/Activity/Pair/Member visits only; cached independently with manual refresh.
- Raised hub/group-member cache TTL 10min → 6h.
- Skip Cloudflare Analytics on localhost.
- **Incident**: the deferred group-member fetch above shipped with a brand-new, cold cache key (`group-members:${slug}`), so the first post-deploy visits to Group/Activity/Pair/Member fired an uncached N-wide parallel burst against `1001albumsgenerator.com` with no warm fallback — got the local IP temporarily banned (403).
- **Fix**: proxy all `1001albumsgenerator.com` GETs through Cloudflare Pages Functions instead of calling the origin directly from the browser:
  - `functions/1001-albums/_lib/upstream.js` — `createUpstreamProxy({ base, freshTtlMs, parseJson })` factory: KV-backed stale-while-revalidate cache, shared across every browser (not per-user like the old localStorage cache), `expirationTtl` (7d) on entries so KV doesn't grow unbounded as more groups use the app, `force` param bypasses cache for manual "Refresh". Deliberately has no single-flight lock on revalidation (considered unnecessary complexity at this app's scale — see git history if it needs revisiting).
  - `proxyApi` (1h TTL, JSON) backs `functions/1001-albums/api/upstream/[[path]].js` — generic passthrough for any `/api/v1/*` GET; `lib/api.js`'s `apiGet` now hits this instead of the origin, so `fetchProject`/`fetchGroup`/`fetchGroupAlbumReviews`/`fetchAlbumCatalog` all benefit with no per-endpoint route needed.
  - `proxySitePage` (24h TTL, HTML) backs `functions/1001-albums/api/global-album-page/[[path]].js` — proxies the scraped per-album reviews page (`fetchGlobalAlbumPage`). `useCachedFetch` (`lib/cache.js`) got a `forceNextFetchRef` so its `refresh()` threads `force` through to the fetcher — scoped to exactly the fetch `refresh()` triggers, doesn't leak into a later cacheKey change (e.g. navigating to a different album).
  - `passthroughUpstream` (no caching) backs `functions/1001-albums/api/notifications/[projectName].js` — notifications are per-user live state, no cross-user caching benefit, so this just fixes the CORS-opaque-ban-message problem (browsers can't read *any* detail of a cross-origin response with no CORS headers, which is what a ban response looks like; same-origin sidesteps this entirely).
  - Write endpoints (`saveRating`, `saveListeningNote`, `markAllNotificationsRead`, `searchAlbumsByWord`) are still direct-to-origin — explicitly deferred, not proxied.
  - Side effect: rate-limit/ban messages in toasts are now accurate (real status + `retry-after` passthrough) for everything proxied, instead of the generic "blocked before the response could be read" fallback.

## Open thread: CSS architecture
Current state: one global `<style>` block in `index.html` (~1000 lines), theming via CSS custom properties + `[data-theme="dark"]`. Works, but styles aren't co-located with the components that use them.

Goal (from Robbie): reusable Preact/htm components — style + layout + content + behavior together — that can be lifted into other apps in this tools repo, sitting on an opinionated, swappable theme.

Decision needed: **goober** (tiny scoped CSS-in-JS, ~1KB, no build step) vs **Tailwind CDN** (utility classes, no build step) vs status quo. Leaned toward goober last session because a component that owns its scoped styles travels better than one that depends on a shared utility vocabulary being present in the host app — but this wasn't prototyped yet.

Next step: build one real component both ways (candidate: `AlbumPlayButton` or a `data-card` list item) and compare the actual code shape before committing repo-wide. Keep the existing CSS custom-property theme underneath either choice — it's already doing the "opinionated, swappable theme" job.

## Other loose ends
- `1001-albums/pipeline/data/apple-album-repair-candidates.json` is untracked in git — output from the Apple track-mapping repair script, unrelated to the above. Check whether it should be committed or is scratch output before it's lost.
