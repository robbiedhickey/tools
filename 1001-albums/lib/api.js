import { SITE_BASE, APP_BASE, TRACK_ALBUM_API_BASE, ALBUM_CATALOG_CACHE_VERSION } from './constants.js';
import { applyCatalogCorrections, correctHubProject } from './cache.js';
import { parseGlobalReviews, parseGlobalAlbumContext } from './format.js';

// ---------- data layer ----------
export class ApiError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function parseRetryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

export function formatRetryAfter(seconds) {
  if (!Number.isFinite(seconds) || seconds == null) return null;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return 'about 1 minute';
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'about 1 hour' : `about ${hours} hours`;
}

export function parseRateLimitWaitFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/\b(?:try again|retry)\s+in\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)\b/i)
    || normalized.match(/\b(\d+)\s*(second|seconds|minute|minutes|hour|hours)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('second')) return formatRetryAfter(amount);
  if (unit.startsWith('minute')) return amount === 1 ? '1 minute' : `${amount} minutes`;
  return amount === 1 ? '1 hour' : `${amount} hours`;
}

// Every 403 observed from 1001albumsgenerator.com across this project's research has been the
// same IP-ban response (confirmed live 2026-06-23: "Your IP has been temporarily banned...").
// Nothing in the API ever documents 403 for any other reason, so treating any 403 as a rate
// limit — without needing to parse a JSON body — lets this cover endpoints that return HTML or
// a body shape we don't otherwise parse (Wikipedia-style scraping, listening-note, notifications).
export function isRateLimitStatus(status) {
  return status === 429 || status === 403;
}

export function describeRateLimit(res) {
  const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'));
  const retryHint = formatRetryAfter(retryAfter);
  const prefix = res.status === 403 ? 'Your IP has been temporarily blocked by the API.' : 'The API rate limit has been hit.';
  return retryHint
    ? `${prefix} Try again in ${retryHint}.`
    : `${prefix} Try again in a little while.`;
}

export function formatApiErrorMessage(res, body, bodyText) {
  const message = body && typeof body.message === 'string' ? body.message.trim() : '';
  if (isRateLimitStatus(res.status)) {
    const wait = parseRateLimitWaitFromText(message || bodyText);
    const prefix = res.status === 403 ? 'Your IP has been temporarily blocked by the API.' : 'The API rate limit has been hit.';
    if (wait) return `${prefix} Try again in ${wait}.`;
    if (message) return message;
    return describeRateLimit(res);
  }

  if (message) return message;
  if (bodyText) {
    const trimmed = bodyText.trim();
    if (trimmed && !/^[<{]/.test(trimmed) && trimmed.length <= 160) return trimmed;
  }
  return `Request failed (${res.status})`;
}

// A banned/rate-limited response from 1001albumsgenerator.com omits CORS headers entirely
// (confirmed live 2026-06-23: a normal 403 has `Access-Control-Allow-Origin: *`, a banned one has
// no CORS headers at all) — so from a browser, fetch() rejects with an opaque TypeError before
// any status code is readable. This is the only signal available in that case. Use this only for
// fetches that hit SITE_BASE directly (saveListeningNote, saveRating, markAllNotificationsRead) —
// everything else goes through our own Pages Functions, where a TypeError means our own origin was
// unreachable, not that the upstream API rate-limited us (see describeOwnFetchFailure).
export function describeFetchFailure(err) {
  if (!(err instanceof TypeError)) return err.message;
  return navigator.onLine === false
    ? 'Network is offline. Try again once you have a connection.'
    : 'The request was blocked before the response could be read. You may be rate limited or temporarily blocked; try again in a little while.';
}

// For fetches that hit our own origin (Pages Functions backed by KV, e.g. the upstream/
// global-album-page proxies and the favorites API) — these always return a normal Response, even
// when the thing they proxy to is itself rate-limited, so a raw TypeError here just means our own
// origin didn't respond (offline, edge hiccup, etc.), never "blocked by the API".
export function describeOwnFetchFailure(err) {
  if (!(err instanceof TypeError)) return err.message;
  return navigator.onLine === false
    ? 'Network is offline. Try again once you have a connection.'
    : "Couldn't reach the server. Try again in a little while.";
}

// Shared formatter for errors thrown by the scraped-page fetchers below: 'lookup failed' is an
// internal sentinel for "got a response, just not an ok/useful one" with no better message to
// show, so it's hidden in favor of each caller's own generic fallback text.
export function formatCacheErrorMessage(err) {
  if (!err) return '';
  return err.message === 'lookup failed' ? '' : describeOwnFetchFailure(err);
}

// Every 1001albumsgenerator.com/api/v1 GET goes through our own upstream proxy (see
// functions/1001-albums/api/upstream/[[path]].js) instead of hitting the origin directly — it's
// a KV-backed stale-while-revalidate cache shared across every browser, so N users no longer
// means N independent origin fetches. `force` (manual "Refresh") bypasses that cache and always
// fetches live.
const UPSTREAM_PROXY_BASE = `${APP_BASE}api/upstream`;

export async function apiGet(path, { force = false } = {}) {
  const url = `${UPSTREAM_PROXY_BASE}${path}${force ? '?refresh=1' : ''}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new ApiError(describeOwnFetchFailure(err), 0, { cause: err });
  }
  const bodyText = await res.text();
  let body = null;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch (e) {}
  }
  if (!res.ok) {
    throw new ApiError(formatApiErrorMessage(res, body, bodyText), res.status, { body, bodyText });
  }
  return body;
}

export const fetchProject = (name, opts) => apiGet(`/projects/${encodeURIComponent(name)}`, opts);
export const fetchGroup = (slug, opts) => apiGet(`/groups/${encodeURIComponent(slug)}`, opts);
export const fetchGroupAlbumReviews = (groupSlug, albumUuid) => apiGet(`/groups/${encodeURIComponent(groupSlug)}/albums/${encodeURIComponent(albumUuid)}`);
let catalogCorrectionsPromise = null;
export async function fetchCatalogCorrections() {
  if (!catalogCorrectionsPromise) {
    catalogCorrectionsPromise = fetch(`${APP_BASE}catalog-corrections.json?v=${ALBUM_CATALOG_CACHE_VERSION}`)
      .then(res => res.ok ? res.json() : { global: {}, user: {} })
      .catch(() => ({ global: {}, user: {} }));
  }
  return catalogCorrectionsPromise;
}
export async function fetchAlbumCatalog(source = 'global') {
  const endpoint = source === 'user' ? '/user-albums/stats' : '/albums/stats';
  const data = await apiGet(endpoint);
  const albums = (data && data.albums) || [];
  const corrections = await fetchCatalogCorrections();
  return applyCatalogCorrections(albums, source, corrections);
}
export async function searchAlbumsByWord(phrase) {
  const res = await fetch(`${SITE_BASE}/api/stats/albums-by-word`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'Rate limited — try again in a moment' : `HTTP ${res.status}`);
  const data = await res.json();
  return data.albums || [];
}

// Undocumented write endpoint, confirmed live to require no auth/cookie/CORS preflight beyond a
// plain POST — see 1001-albums/WRITE_API_PLAN.md. Lives under the bare /api root, not /api/v1.
export async function saveListeningNote(projectName, albumId, notes) {
  let res;
  try {
    res = await fetch(`${SITE_BASE}/api/${encodeURIComponent(projectName)}/${encodeURIComponent(albumId)}/listening-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, isUserAlbum: false }),
    });
  } catch (err) {
    throw new Error(describeFetchFailure(err));
  }
  if (isRateLimitStatus(res.status)) throw new Error(describeRateLimit(res));
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.success !== true) {
    throw new Error('Failed to save listening note.');
  }
  return body;
}

// Verified live 2026-06-23 — requires no auth/cookie/CORS preflight beyond a plain POST, and
// works against any unrated history entry, not just the one the real site's daily card defaults
// to. Rejects (still HTTP 200, success:false) if the entry is already rated, or if albumUuid and
// generatedAlbumId don't both belong to the same entry — see 1001-albums/WRITE_API_PLAN.md.
export async function saveRating(projectName, albumUuid, generatedAlbumId, rating, notes) {
  let res;
  try {
    res = await fetch(`${SITE_BASE}/api/${encodeURIComponent(projectName)}/${encodeURIComponent(albumUuid)}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, notes: notes || '', fromHistoryView: true, generatedAlbumId, isUserAlbum: false }),
    });
  } catch (err) {
    throw new Error(describeFetchFailure(err));
  }
  if (isRateLimitStatus(res.status)) throw new Error(describeRateLimit(res));
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.success !== true) {
    throw new Error('Failed to submit rating — it may already be rated.');
  }
  return body;
}

// Backed by this site's own Pages Function + KV (functions/1001-albums/api/favorites/), not the
// 1001albumsgenerator.com API — so these hit our own origin with a relative path, not SITE_BASE.
export async function fetchFavorites(projectName) {
  let res;
  try {
    res = await fetch(`${APP_BASE}api/favorites/${encodeURIComponent(projectName)}`);
  } catch (err) {
    throw new Error(describeOwnFetchFailure(err));
  }
  if (!res.ok) throw new Error('Failed to load favorites.');
  try {
    return await res.json();
  } catch (err) {
    // A 200 with a non-JSON body (e.g. the SPA's own index.html, if a redirect/routing rule ever
    // shadows this Function) surfaces as a raw "Unexpected token '<'" SyntaxError — translate it
    // to something a user can actually read instead of leaking the parser's internal message.
    throw new Error('Favorites service returned an unexpected response. Try again in a little while.');
  }
}
export async function putFavoriteTrack(projectName, trackId, entry) {
  let res;
  try {
    res = await fetch(`${APP_BASE}api/favorites/${encodeURIComponent(projectName)}/${encodeURIComponent(trackId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    throw new Error(describeOwnFetchFailure(err));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'Failed to save favorite.');
  }
}
export async function deleteFavoriteTrack(projectName, trackId) {
  let res;
  try {
    res = await fetch(`${APP_BASE}api/favorites/${encodeURIComponent(projectName)}/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
  } catch (err) {
    throw new Error(describeOwnFetchFailure(err));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'Failed to remove favorite.');
  }
}

// Undocumented endpoint the live site uses when its notification bell is opened. Keep this behind
// an explicit button so the Kongsole doesn't clear unread state as a side effect of browsing.
export async function markAllNotificationsRead(projectName) {
  let res;
  try {
    res = await fetch(`${SITE_BASE}/api/notifications/${encodeURIComponent(projectName)}/read-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (err) {
    throw new Error(describeFetchFailure(err));
  }
  if (isRateLimitStatus(res.status)) throw new Error(describeRateLimit(res));
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.success === false)) {
    throw new Error('Failed to mark notifications read.');
  }
  return body;
}
// Loads just your own project plus the group's own aggregate stats (one cheap /groups/:slug call,
// not one per member) — enough for Today/Backlog/Me. The per-member fan-out that used to happen
// here on every load now happens lazily in loadGroupMembers, only when a view that actually needs
// every member's full history (Group/Activity/Pair/Member) is visited.
export async function loadMe(projectName, { force = false } = {}) {
  const corrections = await fetchCatalogCorrections();
  const me = correctHubProject(await fetchProject(projectName, { force }), corrections);
  const group = me.group && me.group.slug ? await fetchGroup(me.group.slug, { force }) : null;
  return { me, group };
}

export async function loadGroupMembers(group, projectName, { force = false } = {}) {
  const corrections = await fetchCatalogCorrections();
  const memberNames = group.members.map(m => m.name);
  const results = await Promise.all(memberNames.map(name =>
    fetchProject(name, { force }).catch(err => ({ __error: err, __name: name }))
  ));
  const members = {};
  memberNames.forEach((name, i) => { members[name] = correctHubProject(results[i], corrections); });
  return members;
}

// One fetch of the scraped global-reviews page serves both AlbumSummaryContext (genres/rating)
// and GlobalReviewsPreview (reviews/distribution/keywords) via the shared global-album-page
// cache — see useCachedFetch and globalAlbumPageCacheKey. Goes through our own
// api/global-album-page proxy (KV-cached, 24h) rather than fetching 1001albumsgenerator.com
// directly — same-origin means a ban/rate-limit now comes back as a normal readable Response
// instead of the opaque CORS failure this used to hit. `force` is threaded from useCachedFetch's
// refresh() (see the forceNextFetchRef in lib/cache.js) so manual Refresh bypasses the shared
// proxy cache too, not just the local one.
export function fetchGlobalAlbumPage(url, force = false) {
  const path = new URL(url).pathname;
  return fetch(`${APP_BASE}api/global-album-page${path}${force ? '?refresh=1' : ''}`)
    .then((r) => {
      if (r.ok) return r.text();
      return r.json().catch(() => null).then((body) => {
        throw new Error(isRateLimitStatus(r.status) ? describeRateLimit(r) : ((body && body.message) || 'lookup failed'));
      });
    })
    .then((text) => ({ reviews: parseGlobalReviews(text, 100), context: parseGlobalAlbumContext(text) }));
}

const albumTrackRecordPromises = new Map();
export function fetchAlbumTrackRecord(spotifyAlbumId, { force = false } = {}) {
  if (!spotifyAlbumId) return Promise.resolve(null);
  if (force) albumTrackRecordPromises.delete(spotifyAlbumId);
  if (!albumTrackRecordPromises.has(spotifyAlbumId)) {
    const request = fetch(`${TRACK_ALBUM_API_BASE}/${encodeURIComponent(spotifyAlbumId)}`, force ? { cache: 'reload' } : undefined)
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Track data lookup failed (${res.status})`);
        return res.json();
      })
      .catch((err) => {
        albumTrackRecordPromises.delete(spotifyAlbumId);
        throw err;
      });
    albumTrackRecordPromises.set(spotifyAlbumId, request);
  }
  return albumTrackRecordPromises.get(spotifyAlbumId);
}
