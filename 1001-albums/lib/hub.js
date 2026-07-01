import { useState, useEffect, useCallback } from 'preact/hooks';
import { APP_BASE } from './constants.js';
import {
  readCache, writeCache, writeCurrentProjectName, correctHubProject,
  readGroupMembersCache, writeGroupMembersCache,
} from './cache.js';
import {
  fetchCatalogCorrections, loadMe, loadGroupMembers, isRateLimitStatus, describeRateLimit,
  describeFetchFailure, markAllNotificationsRead,
} from './api.js';
import { useSettingsContext } from './settings.js';

export function isUnrated(entry) {
  return !!entry.album && !('rating' in entry);
}

export function deriveBacklog(project) {
  return (project.history || [])
    .filter(isUnrated)
    .slice()
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
}

export function backlogEntryId(entry) {
  return (entry && entry.album && entry.album.uuid) || entry.generatedAt;
}

export function findAlbumInHub(hub, albumId) {
  if (!hub || !albumId) return null;
  const occurrences = [];
  for (const [member, project] of Object.entries(hub.members || {})) {
    if (!project || project.__error) continue;
    for (const entry of project.history || []) {
      if (entry.album && entry.album.uuid === albumId) occurrences.push({ member, entry });
    }
  }
  if (!occurrences.length) return null;
  const first = occurrences[0].entry;
  return {
    album: first.album,
    generatedAt: occurrences.map(o => o.entry.generatedAt).sort()[0],
    globalRating: first.globalRating,
    occurrences,
  };
}

export function computeAlbumComparison(hub, albumId, projectName, fallbackGlobalRating = null) {
  if (!hub || !albumId) return null;
  const albumRecord = findAlbumInHub(hub, albumId);
  const me = hub.members && hub.members[projectName];
  const userEntry = me && !me.__error
    ? (me.history || []).find(entry => entry.album && entry.album.uuid === albumId)
    : null;
  const ratings = albumRecord
    ? albumRecord.occurrences
        .map(o => o.entry.rating)
        .filter(rating => typeof rating === 'number')
    : [];
  const groupAverage = ratings.length
    ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 100) / 100
    : null;
  return {
    userRating: userEntry && 'rating' in userEntry ? userEntry.rating : null,
    groupAverage,
    groupVotes: ratings.length,
    globalRating: fallbackGlobalRating != null ? fallbackGlobalRating : (albumRecord ? albumRecord.globalRating : null),
  };
}

export function deriveGroupAlbumTable(membersMap) {
  const byUuid = new Map();
  for (const [name, project] of Object.entries(membersMap)) {
    if (!project || project.__error) continue;
    for (const entry of project.history || []) {
      if (!entry.album) continue;
      const uuid = entry.album.uuid;
      if (!byUuid.has(uuid)) byUuid.set(uuid, { album: entry.album, ratings: [], earliestAt: entry.generatedAt });
      const row = byUuid.get(uuid);
      if (entry.generatedAt < row.earliestAt) row.earliestAt = entry.generatedAt;
      if (typeof entry.rating === 'number') {
        row.ratings.push({ member: name, rating: entry.rating, review: entry.review || '' });
      }
    }
  }
  return [...byUuid.values()]
    .map(({ album, ratings, earliestAt }) => {
      const votes = ratings.length;
      const avg = votes ? ratings.reduce((s, r) => s + r.rating, 0) / votes : null;
      return { album, ratings, votes, earliestAt, averageRating: avg !== null ? Math.round(avg * 100) / 100 : null };
    })
    .filter(r => r.votes > 0);
}

// The API has no separate "rated at" timestamp — only generatedAt (when the album was
// assigned). Ratings are almost always submitted within a day or two of generation, so it's
// the closest available proxy for "recent activity" across the group.
export function deriveActivityFeed(membersMap, limit = 50) {
  const feed = [];
  for (const [name, project] of Object.entries(membersMap)) {
    if (!project || project.__error) continue;
    for (const entry of project.history || []) {
      if (!entry.album || !('rating' in entry)) continue;
      feed.push({ member: name, album: entry.album, rating: entry.rating, review: entry.review || '', generatedAt: entry.generatedAt });
    }
  }
  return feed.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)).slice(0, limit);
}

export function deriveAlignment(membersMap) {
  const names = Object.keys(membersMap).filter(n => membersMap[n] && !membersMap[n].__error);
  const ratingsByMember = {};
  const albumsByUuid = new Map();
  for (const name of names) {
    const m = new Map();
    for (const entry of membersMap[name].history || []) {
      if (entry.album && typeof entry.rating === 'number') {
        m.set(entry.album.uuid, entry.rating);
        if (!albumsByUuid.has(entry.album.uuid)) albumsByUuid.set(entry.album.uuid, entry.album);
      }
    }
    ratingsByMember[name] = m;
  }
  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const ma = ratingsByMember[a], mb = ratingsByMember[b];
      let sum = 0, n = 0;
      const details = [];
      for (const [uuid, ra] of ma) {
        if (mb.has(uuid)) {
          const rb = mb.get(uuid);
          sum += Math.abs(ra - rb);
          n++;
          details.push({ album: albumsByUuid.get(uuid), ratingA: ra, ratingB: rb, diff: Math.abs(ra - rb) });
        }
      }
      if (n >= 2) {
        const alignment = Math.max(0, Math.round(100 * (1 - (sum / n) / 4)));
        details.sort((x, y) => y.diff - x.diff);
        pairs.push({ a, b, alignment, shared: n, details });
      }
    }
  }
  return pairs.sort((x, y) => y.alignment - x.alignment);
}

export function computeUserStats(project) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let dnl = 0;
  const genreMap = new Map();
  const decadeMap = new Map();
  const styleMap = new Map();
  let totalRated = 0, sumRating = 0;
  for (const entry of project.history || []) {
    if (!('rating' in entry)) continue;
    if (entry.rating === 'did-not-listen') { dnl++; continue; }
    if (typeof entry.rating !== 'number') continue;
    dist[entry.rating] = (dist[entry.rating] || 0) + 1;
    totalRated++; sumRating += entry.rating;
    const album = entry.album;
    if (album) {
      for (const g of album.genres || []) {
        const cur = genreMap.get(g) || { sum: 0, count: 0, albums: [] };
        cur.sum += entry.rating; cur.count++;
        cur.albums.push({ album, rating: entry.rating });
        genreMap.set(g, cur);
      }
      for (const s of album.styles || []) {
        const cur = styleMap.get(s) || { sum: 0, count: 0, albums: [] };
        cur.sum += entry.rating; cur.count++;
        cur.albums.push({ album, rating: entry.rating });
        styleMap.set(s, cur);
      }
      const decade = album.releaseDate ? album.releaseDate.slice(0, 3) + '0' : null;
      if (decade) {
        const cur = decadeMap.get(decade) || { sum: 0, count: 0, albums: [] };
        cur.sum += entry.rating; cur.count++;
        cur.albums.push({ album, rating: entry.rating });
        decadeMap.set(decade, cur);
      }
    }
  }
  const byAvgDesc = (a, b) => b.avg - a.avg;
  const genres = [...genreMap.entries()]
    .map(([genre, { sum, count, albums }]) => ({
      genre, count, avg: Math.round((sum / count) * 100) / 100, albums: albums.sort((a, b) => b.rating - a.rating),
    }))
    .sort(byAvgDesc);
  const styles = [...styleMap.entries()]
    .map(([style, { sum, count, albums }]) => ({
      style, count, avg: Math.round((sum / count) * 100) / 100, albums: albums.sort((a, b) => b.rating - a.rating),
    }))
    .sort(byAvgDesc);
  const decades = [...decadeMap.entries()]
    .map(([decade, { sum, count, albums }]) => ({
      decade, count, avg: Math.round((sum / count) * 100) / 100, albums: albums.sort((a, b) => b.rating - a.rating),
    }))
    .sort((a, b) => a.decade.localeCompare(b.decade));
  const ratings = (project.history || [])
    .filter(e => typeof e.rating === 'number' && e.album)
    .map(e => ({ album: e.album, rating: e.rating }))
    .reverse();
  return { dist, dnl, totalRated, avgRating: totalRated ? Math.round((sumRating / totalRated) * 100) / 100 : null, genres, styles, decades, ratings };
}

export function useRecommendations() {
  return useSettingsContext()?.diddy || { enabled: true, toggle: () => {} };
}

// Loads only your own project + the group's aggregate stats (see loadMe) — cheap regardless of
// group size. Group/Activity/Pair/Member additionally need every member's full history; that's
// handled by the separate useGroupMembers hook below, fetched only when one of those is visited.
export function useHub(projectName) {
  const [state, setState] = useState(() => {
    if (!projectName) return { status: 'loading', data: null, error: null, refreshError: null, fetchedAt: null, stale: false, refreshing: false };
    const cached = readCache(projectName);
    if (cached) return { status: 'ready', data: cached.data, error: null, refreshError: null, fetchedAt: cached.fetchedAt, stale: cached.stale, refreshing: cached.stale };
    return { status: 'loading', data: null, error: null, refreshError: null, fetchedAt: null, stale: false, refreshing: false };
  });

  const load = useCallback(async (force) => {
    if (!projectName) return;
    if (!force) {
      const cached = readCache(projectName);
      if (cached) {
        const corrections = await fetchCatalogCorrections();
        const data = { ...cached.data, me: correctHubProject(cached.data.me, corrections) };
        writeCurrentProjectName(projectName);
        setState({ status: 'ready', data, error: null, refreshError: null, fetchedAt: cached.fetchedAt, stale: cached.stale, refreshing: cached.stale });
        if (!cached.stale) return;
      } else {
        setState(s => ({ ...s, status: 'loading', error: null, refreshError: null }));
      }
    } else {
      setState(s => ({ ...s, refreshing: true, refreshError: null }));
    }
    try {
      const data = await loadMe(projectName, { force });
      writeCache(projectName, data);
      writeCurrentProjectName((data.me && data.me.name) || projectName);
      setState({ status: 'ready', data, error: null, refreshError: null, fetchedAt: Date.now(), stale: false, refreshing: false });
    } catch (err) {
      setState(s => (s.data ? { ...s, refreshError: err, refreshing: false } : { status: 'error', data: null, error: err, refreshError: null, fetchedAt: null, stale: false, refreshing: false }));
    }
  }, [projectName]);

  useEffect(() => { load(false); }, [load]);

  return { ...state, refresh: () => load(true), dismissRefreshError: () => setState(s => ({ ...s, refreshError: null })) };
}

// Fetches every group member's full project — the expensive fan-out `useHub` used to do
// unconditionally on every load. `enabled` gates the actual network fetch (and the effect that
// triggers it) so it only fires while a view that needs it (Group/Activity/Pair/Member) is
// mounted; the cached result is shared across all four so switching between them doesn't
// refetch. Same 6h TTL as the hub cache, plus a manual `refresh()` for an on-demand update.
export function useGroupMembers(projectName, group, enabled) {
  const slug = group ? group.slug : null;
  const [state, setState] = useState(() => {
    if (!slug) return { status: 'idle', members: null, error: null, fetchedAt: null, stale: false, refreshing: false };
    const cached = readGroupMembersCache(slug);
    return cached
      ? { status: 'ready', members: cached.members, error: null, fetchedAt: cached.fetchedAt, stale: cached.stale, refreshing: false }
      : { status: 'idle', members: null, error: null, fetchedAt: null, stale: false, refreshing: false };
  });

  const load = useCallback(async (force) => {
    if (!slug) return;
    if (!force) {
      const cached = readGroupMembersCache(slug);
      if (cached) {
        setState({ status: 'ready', members: cached.members, error: null, fetchedAt: cached.fetchedAt, stale: cached.stale, refreshing: cached.stale });
        if (!cached.stale) return;
      } else {
        setState(s => ({ ...s, status: 'loading' }));
      }
    } else {
      setState(s => ({ ...s, refreshing: true }));
    }
    try {
      const members = await loadGroupMembers(group, projectName, { force });
      writeGroupMembersCache(slug, members);
      setState({ status: 'ready', members, error: null, fetchedAt: Date.now(), stale: false, refreshing: false });
    } catch (err) {
      setState(s => (s.members ? { ...s, refreshing: false } : { status: 'error', members: null, error: err, fetchedAt: null, stale: false, refreshing: false }));
    }
  }, [slug, projectName]);

  useEffect(() => { if (enabled) load(false); }, [enabled, load]);

  return { ...state, refresh: () => load(true) };
}

// The site's own notification bell is backed by /api/notifications/:projectName, a separate,
// undocumented endpoint from the v1 API. Loading this hook uses `read=false` (a safe GET) so
// viewing the tab never marks anything as read on the real site. Goes through our own
// api/notifications passthrough (see functions/1001-albums/api/notifications/[projectName].js)
// rather than SITE_BASE directly — no caching (this is per-user live state, nothing to share
// across browsers), just same-origin so a ban/rate-limit comes back readable instead of opaque.
export function useNotifications(projectName) {
  const [state, setState] = useState({ status: 'idle', notifications: [], errorMessage: '', markingRead: false, markReadMessage: '' });

  useEffect(() => {
    if (!projectName) return;
    let cancelled = false;
    setState({ status: 'loading', notifications: [], errorMessage: '', markingRead: false, markReadMessage: '' });
    fetch(`${APP_BASE}api/notifications/${encodeURIComponent(projectName)}?read=false`)
      .then((r) => { if (!r.ok) throw new Error(isRateLimitStatus(r.status) ? describeRateLimit(r) : 'lookup failed'); return r.json(); })
      .then((data) => { if (!cancelled) setState({ status: 'ready', notifications: data.notifications || [], errorMessage: '', markingRead: false, markReadMessage: '' }); })
      .catch((e) => { if (!cancelled) setState({ status: 'error', notifications: [], errorMessage: e.message === 'lookup failed' ? '' : describeFetchFailure(e), markingRead: false, markReadMessage: '' }); });
    return () => { cancelled = true; };
  }, [projectName]);

  const markAllRead = useCallback(async () => {
    setState(s => ({ ...s, markingRead: true, markReadMessage: '' }));
    try {
      await markAllNotificationsRead(projectName);
      setState(s => ({ ...s, status: 'ready', notifications: [], errorMessage: '', markingRead: false, markReadMessage: 'Marked all notifications read.' }));
    } catch (e) {
      setState(s => ({ ...s, markingRead: false, markReadMessage: e.message || "Couldn't mark notifications read." }));
    }
  }, [projectName]);

  return { ...state, markAllRead };
}
