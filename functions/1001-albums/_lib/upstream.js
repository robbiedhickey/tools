// KV has a cap on total entries at our usage tier, and this cache grows with every distinct path
// any group ever requests, not just our own — without an expiry, entries for groups that stop
// using the app would sit in KV forever. A week is generous relative to any of the freshness
// windows below (any entry still in active use gets rewritten — and its expiry reset — well
// before this fires) while still bounding growth from abandoned paths.
const ENTRY_TTL_SECONDS = 7 * 24 * 60 * 60;

async function fetchUpstream(base, path, parseJson) {
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

// Builds a stale-while-revalidate KV proxy for a fixed upstream base URL — shared across every
// browser instead of each one hitting the origin independently. This is what stops a cold
// client-side cache (a newly shipped feature, or a group of users opening the app around the same
// time) from producing an N-wide burst against an API that IP-bans on excess requests: once a
// path is cached, every browser shares it.
//
// The base is always a fixed, hardcoded origin, never taken from the request — accepting an
// arbitrary URL to fetch server-side would make this an open proxy.
export function createUpstreamProxy({ base, freshTtlMs, parseJson = true }) {
  const cacheKey = (path) => `1001-albums:upstream:${base}:${path}`;

  function writeCacheEntry(env, path, data) {
    return env.TOOLS_KV.put(
      cacheKey(path),
      JSON.stringify({ data, fetchedAt: Date.now() }),
      { expirationTtl: ENTRY_TTL_SECONDS }
    );
  }

  // On upstream failure (rate limit, IP ban, downtime) the old KV entry is left untouched, so
  // callers keep getting last-known-good data instead of the failure surfacing. Multiple
  // concurrent callers can each trigger their own revalidate() for the same path — no
  // single-flight lock — which briefly multiplies requests to the origin right when a path goes
  // stale, but bounded by however many browsers are actively requesting that exact path in that
  // instant, which is small at this app's scale.
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
      return { data, stale: false };
    }

    const cached = await env.TOOLS_KV.get(key, 'json');
    if (cached && Date.now() - cached.fetchedAt <= freshTtlMs) {
      return { data: cached.data, stale: false };
    }
    if (cached) {
      waitUntil(revalidate(env, path));
      return { data: cached.data, stale: true };
    }

    const data = await fetchUpstream(base, path, parseJson);
    await writeCacheEntry(env, path, data);
    return { data, stale: false };
  };
}

// Shared across every user, so staleness here affects the whole group, not just one person's
// browser — e.g. a fresh rating should show up for groupmates without them needing to hit
// Refresh. 1h keeps that reasonably current while still cutting origin traffic by ~60x during any
// hour where the same path is requested repeatedly.
export const proxyApi = createUpstreamProxy({
  base: 'https://1001albumsgenerator.com/api/v1',
  freshTtlMs: 60 * 60 * 1000,
  parseJson: true,
});

// Scraped review/context HTML for an album — reviews trickle in slowly, so a day-long TTL doesn't
// mean noticeably stale data, just far fewer scrapes of the same page across every browser and
// every user who's ever looked at that album.
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
