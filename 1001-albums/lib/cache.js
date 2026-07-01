import { useState, useEffect, useRef } from 'preact/hooks';
import { CURRENT_PROJECT_KEY, CACHE_TTL_MS, ALBUM_CATALOG_CACHE_VERSION } from './constants.js';

export const albumCatalogCacheKey = (source) => `album-catalog:${ALBUM_CATALOG_CACHE_VERSION}:${source}`;

export function applyCatalogCorrections(albums, source, corrections) {
  return albums.map(album => applyCatalogCorrectionToAlbum(album, corrections, source));
}
export function catalogCorrectionForAlbum(album, corrections, source = null) {
  if (!album?.spotifyId) return null;
  const maps = source
    ? [corrections[source === 'user' ? 'user' : 'global'] || {}]
    : [corrections.global || {}, corrections.user || {}];
  for (const map of maps) {
    if (map[album.spotifyId]) return map[album.spotifyId];
  }
  return null;
}
export function applyCatalogCorrectionToAlbum(album, corrections, source = null) {
  const correction = catalogCorrectionForAlbum(album, corrections, source);
  if (!correction) return album;
  const next = { ...album };
  if (correction.spotifyId && correction.spotifyId !== album.spotifyId) {
    next.originalSpotifyId = album.spotifyId;
    next.spotifyId = correction.spotifyId;
  }
  if (correction.appleMusicId) next.appleMusicId = correction.appleMusicId;
  if (correction.globalReviewsUrl) next.globalReviewsUrl = correction.globalReviewsUrl;
  return next;
}
export function correctHubProject(project, corrections) {
  if (!project || project.__error) return project;
  return {
    ...project,
    currentAlbum: project.currentAlbum
      ? applyCatalogCorrectionToAlbum(project.currentAlbum, corrections)
      : project.currentAlbum,
    history: (project.history || []).map(entry => entry.album
      ? { ...entry, album: applyCatalogCorrectionToAlbum(entry.album, corrections) }
      : entry),
  };
}
export function applyHubCatalogCorrections(hub, corrections) {
  const members = {};
  for (const [name, project] of Object.entries(hub.members || {})) {
    members[name] = correctHubProject(project, corrections);
  }
  return {
    ...hub,
    me: correctHubProject(hub.me, corrections),
    members,
  };
}

// ---------- localStorage cache ----------
export const cacheKey = (name) => `hub:${name}`;
// Reviews + the keyword/distribution context are two halves of one scraped page fetch, so they
// share one cache entry — that also means a Summary-tab visit and a Reviews-tab visit reuse the
// same fetch instead of each independently hitting the network.
export const globalAlbumPageCacheKey = (url) => `global-album-page:v3:${url}`;
export function readCurrentProjectName() {
  try { return localStorage.getItem(CURRENT_PROJECT_KEY) || ''; } catch (e) { return ''; }
}
export function writeCurrentProjectName(name) {
  try { localStorage.setItem(CURRENT_PROJECT_KEY, name); } catch (e) {}
}
export function clearCurrentProjectName() {
  try { localStorage.removeItem(CURRENT_PROJECT_KEY); } catch (e) {}
}
export function readCache(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...parsed, stale: Date.now() - parsed.fetchedAt > CACHE_TTL_MS };
  } catch (e) { return null; }
}
export function writeCache(name, data) {
  try { localStorage.setItem(cacheKey(name), JSON.stringify({ fetchedAt: Date.now(), data })); } catch (e) {}
}
// Cached separately from the hub's own `me`/`group` (see useHub) so that visiting Group/Activity/
// Pair/Member — the only views that need every member's full history — doesn't force a refetch of
// data those views already have cached from a previous visit.
export const groupMembersCacheKey = (slug) => `group-members:${slug}`;
export function readGroupMembersCache(slug) {
  try {
    const raw = localStorage.getItem(groupMembersCacheKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...parsed, stale: Date.now() - parsed.fetchedAt > CACHE_TTL_MS };
  } catch (e) { return null; }
}
export function writeGroupMembersCache(slug, members) {
  try { localStorage.setItem(groupMembersCacheKey(slug), JSON.stringify({ fetchedAt: Date.now(), members })); } catch (e) {}
}
// Generic localStorage cache for any external/scraped lookup, used via useCachedFetch below.
// Unlike readCache/writeCache (the hub's own cache, which has a TTL and a "stale" flag the UI
// surfaces explicitly), these have no TTL — they cache "forever" but useCachedFetch's isEmpty
// check distrusts an empty/bad result instead of serving it back indefinitely.
export function readJsonCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
export function writeJsonCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), value })); } catch (e) {}
}
export function readAlbumCatalog(source = 'global') {
  try {
    const raw = localStorage.getItem(albumCatalogCacheKey(source));
    if (!raw) return null;
    return JSON.parse(raw); // { fetchedAt, albums }
  } catch (e) { return null; }
}
export function writeAlbumCatalog(source, albums) {
  try { localStorage.setItem(albumCatalogCacheKey(source), JSON.stringify({ fetchedAt: Date.now(), albums })); } catch (e) {}
}

// Multiple components can call useCachedFetch with the same cacheKey (e.g. the Summary tab's
// genres section and the Global Reviews tab both fetch the same scraped album page) but each
// holds its own independent hook state. Without this, hitting "Refresh" in one of them rewrites
// localStorage but leaves the other showing its stale (possibly empty) value until it remounts —
// which is why closing and reopening the app "fixed" missing genre pills but an in-app refresh
// didn't. This pub/sub lets a successful refresh in any instance push the new value to every
// other mounted instance sharing the same key.
const cacheKeySubscribers = new Map();
export function subscribeCacheKey(cacheKey, onUpdate) {
  if (!cacheKey) return () => {};
  let subs = cacheKeySubscribers.get(cacheKey);
  if (!subs) { subs = new Set(); cacheKeySubscribers.set(cacheKey, subs); }
  subs.add(onUpdate);
  return () => {
    subs.delete(onUpdate);
    if (subs.size === 0) cacheKeySubscribers.delete(cacheKey);
  };
}
export function broadcastCacheKeyUpdate(cacheKey, value) {
  const subs = cacheKeySubscribers.get(cacheKey);
  if (subs) subs.forEach((onUpdate) => onUpdate(value));
}

// AlbumSpotlight mounts two useCachedFetch consumers of the same cacheKey at once (the genres
// section and the compare/discovery section, both backed by the same scraped album page), so on
// a cold cache both fire their own fetch() to the same URL simultaneously. This map collapses
// concurrent requests for the same key into one in-flight promise so every caller awaits the
// same network request instead of doubling it — halves request volume against an upstream that
// rate-limits by IP (see fetchGlobalAlbumPage/useNotifications' isRateLimitStatus handling).
const inFlightFetches = new Map();
export function fetchDeduped(cacheKey, fetcher) {
  const existing = inFlightFetches.get(cacheKey);
  if (existing) return existing;
  const promise = fetcher().finally(() => {
    inFlightFetches.delete(cacheKey);
  });
  inFlightFetches.set(cacheKey, promise);
  return promise;
}

// Centralizes the "fetch once, cache forever in localStorage, but distrust an empty/bad cached
// result and allow a manual refresh" pattern used by every scraped/external lookup in this app
// (global reviews+context, Apple track metadata). Without the isEmpty distrust check, a single
// bad fetch (a transient rate limit, a CORS/CDN hiccup) gets cached and served back forever with
// no way to recover short of clearing localStorage by hand — see the Tracks-tab bug this fixed.
// cacheKey of null/'' means there's nothing to fetch (e.g. no Apple Music ID) → status 'hidden'.
export function useCachedFetch(cacheKey, fetcher, { isEmpty } = {}) {
  const [state, setState] = useState(() => {
    if (!cacheKey) return { status: 'hidden', value: null, error: null };
    const cached = readJsonCache(cacheKey);
    if (cached && cached.value != null && !(isEmpty && isEmpty(cached.value))) {
      return { status: 'ready', value: cached.value, error: null };
    }
    return { status: 'loading', value: null, error: null };
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Set by refresh() immediately before bumping refreshNonce, and consumed (reset to false) the
  // very next time the effect below runs — which is guaranteed to be the run refresh() caused,
  // since that's the only thing that changes refreshNonce. This scopes "force" to exactly that
  // one fetch: a later cacheKey change (e.g. navigating to a different album) won't inherit it.
  const forceNextFetchRef = useRef(false);

  useEffect(() => {
    if (!cacheKey) {
      setState({ status: 'hidden', value: null, error: null });
      return;
    }
    let cancelled = false;
    const force = forceNextFetchRef.current;
    forceNextFetchRef.current = false;
    const cached = refreshNonce === 0 ? readJsonCache(cacheKey) : null;
    if (cached && cached.value != null && !(isEmpty && isEmpty(cached.value))) {
      setState({ status: 'ready', value: cached.value, error: null });
      return;
    }
    setState(s => s.status === 'loading' ? s : { status: 'loading', value: null, error: null });
    fetchDeduped(cacheKey, () => fetcher(force))
      .then((value) => {
        writeJsonCache(cacheKey, value);
        if (!cancelled) setState({ status: 'ready', value, error: null });
        broadcastCacheKeyUpdate(cacheKey, value);
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', value: null, error });
      });
    return () => { cancelled = true; };
    // fetcher is intentionally excluded — cacheKey already captures "what to fetch" (e.g. the
    // URL), so a fresh fetcher closure on every render doesn't need to retrigger the effect.
  }, [cacheKey, refreshNonce]);

  useEffect(() => subscribeCacheKey(cacheKey, (value) => {
    setState({ status: 'ready', value, error: null });
  }), [cacheKey]);

  return {
    ...state,
    refresh: () => { forceNextFetchRef.current = true; setRefreshNonce(n => n + 1); },
  };
}
