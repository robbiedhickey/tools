// KV has a cap on total entries at our usage tier, and this cache grows with every distinct path
// any group ever requests, not just our own — without an expiry, entries for groups that stop
// using the app would sit in KV forever. A week is generous relative to any of the freshness
// windows below (any entry still in active use gets rewritten — and its expiry reset — well
// before this fires) while still bounding growth from abandoned paths.
const ENTRY_TTL_SECONDS = 7 * 24 * 60 * 60;

// Collapses concurrent fetches for the same upstream URL into one in-flight promise (same
// pattern as fetchDeduped in 1001-albums/lib/cache.js) — several browsers tripping the same cold
// miss or stale window at once would otherwise each fire their own origin request, against an API
// that IP-bans on excess. Per-isolate only (each edge isolate has its own Map), which is fine:
// the point is bounding the burst, not global single-flight.
const inFlightUpstreamFetches = new Map();
function fetchUpstream(base, path, parseJson) {
  const key = `${base}${path}`;
  const existing = inFlightUpstreamFetches.get(key);
  if (existing) return existing;
  const promise = fetchUpstreamUncoalesced(base, path, parseJson).finally(() => {
    inFlightUpstreamFetches.delete(key);
  });
  inFlightUpstreamFetches.set(key, promise);
  return promise;
}

async function fetchUpstreamUncoalesced(base, path, parseJson) {
  const res = await fetch(`${base}${path}`);
  const bodyText = await res.text();
  let body = parseJson ? null : bodyText;
  if (parseJson && bodyText) { try { body = JSON.parse(bodyText); } catch (e) {} }
  if (!res.ok) {
    const message = parseJson && body && body.message ? body.message : `Upstream request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  return body;
}

// Builds a KV proxy for a fixed upstream base URL — shared across every browser instead of each
// one hitting the origin independently. This is what stops a cold client-side cache (a newly
// shipped feature, or a group of users opening the app around the same time) from producing an
// N-wide burst against an API that IP-bans on excess requests: once a path is cached, every
// browser shares it.
//
// Past freshTtlMs, `revalidate` controls whether that shared refresh happens in the background
// (stale-while-revalidate — return the old data now, update KV for the *next* request) or
// blocking (fetch synchronously so the caller gets the new data this request, falling back to
// the stale entry only if the upstream fetch itself fails). Blocking trades a slower response for
// no callers ever seeing revalidated-but-undelivered data — see proxyApi below for why that
// tradeoff matters there but not for proxySitePage.
//
// The base is always a fixed, hardcoded origin, never taken from the request — accepting an
// arbitrary URL to fetch server-side would make this an open proxy.
export function createUpstreamProxy({ base, freshTtlMs, parseJson = true, revalidate: revalidateMode = 'background' }) {
  const cacheKey = (path) => `1001-albums:upstream:${base}:${path}`;

  function writeCacheEntry(env, path, data) {
    return env.TOOLS_KV.put(
      cacheKey(path),
      JSON.stringify({ data, fetchedAt: Date.now() }),
      { expirationTtl: ENTRY_TTL_SECONDS }
    );
  }

  // Only used in 'background' mode. On upstream failure (rate limit, IP ban, downtime) the old KV
  // entry is left untouched, so callers keep getting last-known-good data instead of the failure
  // surfacing. Multiple concurrent callers can each trigger their own revalidate() for the same
  // path — no single-flight lock — which briefly multiplies requests to the origin right when a
  // path goes stale, but bounded by however many browsers are actively requesting that exact path
  // in that instant, which is small at this app's scale.
  async function revalidate(env, path) {
    try {
      const data = await fetchUpstream(base, path, parseJson);
      await writeCacheEntry(env, path, data);
    } catch (e) {
      // leave the stale entry as-is; the next stale request will try revalidating again
    }
  }

  // force=true (manual "Refresh") always fetches synchronously and bypasses the freshness check,
  // preserving the "Refresh always bypasses cache" contract the client already promises its users.
  return async function proxyUpstream(env, waitUntil, path, { force = false } = {}) {
    const key = cacheKey(path);

    if (force) {
      const data = await fetchUpstream(base, path, parseJson);
      await writeCacheEntry(env, path, data);
      return { data, stale: false, fetchedAt: Date.now() };
    }

    const cached = await env.TOOLS_KV.get(key, 'json');
    if (cached && Date.now() - cached.fetchedAt <= freshTtlMs) {
      return { data: cached.data, stale: false, fetchedAt: cached.fetchedAt };
    }
    if (cached) {
      if (revalidateMode === 'blocking') {
        // Fetch synchronously so this request itself gets the revalidated data instead of handing
        // it to whichever request happens to land next — see the module comment for why that
        // matters for proxyApi. Falls back to the stale entry (rather than a 502) on failure, the
        // same last-known-good guarantee 'background' mode gives via revalidate() above.
        try {
          const data = await fetchUpstream(base, path, parseJson);
          await writeCacheEntry(env, path, data);
          return { data, stale: false, fetchedAt: Date.now() };
        } catch (e) {
          return { data: cached.data, stale: true, fetchedAt: cached.fetchedAt };
        }
      }
      waitUntil(revalidate(env, path));
      return { data: cached.data, stale: true, fetchedAt: cached.fetchedAt };
    }

    const data = await fetchUpstream(base, path, parseJson);
    await writeCacheEntry(env, path, data);
    return { data, stale: false, fetchedAt: Date.now() };
  };
}

// Shared across every user, so staleness here affects the whole group, not just one person's
// browser — e.g. a fresh rating should show up for groupmates without them needing to hit
// Refresh. Blocking revalidation means the request that trips the 30-min fresh window pays the
// upstream latency itself, but every request (including that one) gets genuinely current data —
// no window where a revalidated KV entry sits unseen because background SWR handed the stale copy
// to the caller that triggered the refresh. 30 min still cuts origin traffic by ~30x during any
// half hour where the same path is requested repeatedly.
export const proxyApi = createUpstreamProxy({
  base: 'https://1001albumsgenerator.com/api/v1',
  freshTtlMs: 30 * 60 * 1000,
  parseJson: true,
  revalidate: 'blocking',
});

// Scraped review/context HTML for an album — reviews trickle in slowly, so a day-long TTL doesn't
// mean noticeably stale data, just far fewer scrapes of the same page across every browser and
// every user who's ever looked at that album. Left on background revalidation (the default):
// unlike proxyApi, latency matters more than same-request freshness here, and there's no harm in
// the caller that trips the stale window getting one more round of slightly-old HTML while the
// refresh happens behind it.
export const proxySitePage = createUpstreamProxy({
  base: 'https://1001albumsgenerator.com',
  freshTtlMs: 24 * 60 * 60 * 1000,
  parseJson: false,
});

// Thin passthrough for a GET with no useful shared-cache story (e.g. per-user live state like
// notifications, where there's no cross-user reuse to gain from caching). Exists purely so the
// browser talks same-origin and gets a readable Response — see the CORS-opaque-ban comment on
// fetchGlobalAlbumPage in 1001-albums/lib/api.js — without paying for a KV round trip that
// wouldn't help anyway.
export async function passthroughUpstream(base, path) {
  const data = await fetchUpstream(base, path, true);
  return { data, stale: false };
}
