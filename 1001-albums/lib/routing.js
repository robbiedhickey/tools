import {
  APP_BASE, ROUTE_PREFIX, VALID_TABS, VALID_SUBTABS, DISCOVER_ALBUM_TABS,
  DISCOVER_PATH_TO_MODE, DISCOVER_MODE_TO_PATH, LAST_DISCOVER_PATH_KEY,
  TAB_ORDER, NAV_TAB_PARENT,
} from './constants.js';

// ---------- routing ----------
export function parseRouteParts(parts) {
  if (!parts.length) return { projectName: null, tab: 'today', backlogAlbumId: null, albumId: null, subTab: null, discoverSource: 'global', discoverMode: 'browse', discoverQuery: '', discoverAlbumTab: 'summary', discoverReviewKeyword: '', pairA: null, pairB: null };
  if (parts[1] === 'albums' && parts.length > 2) {
    return {
      projectName: decodeURIComponent(parts[0]),
      tab: 'album',
      backlogAlbumId: null,
      albumId: decodeURIComponent(parts[2]),
      subTab: VALID_SUBTABS.has(parts[3]) ? parts[3] : null,
      discoverSource: 'global',
      discoverMode: 'browse',
      discoverQuery: '',
      discoverAlbumTab: 'summary',
      discoverReviewKeyword: '',
      pairA: null,
      pairB: null,
    };
  }
  if (parts[1] === 'group' && parts[2] === 'member' && parts[3]) {
    return { projectName: decodeURIComponent(parts[0]), tab: 'member', memberName: decodeURIComponent(parts[3]), backlogAlbumId: null, albumId: null, subTab: null, discoverSource: 'global', discoverMode: 'browse', discoverQuery: '', discoverAlbumTab: 'summary', discoverReviewKeyword: '', pairA: null, pairB: null };
  }
  if (parts[1] === 'group' && parts[2] === 'pair' && parts.length > 4) {
    return {
      projectName: decodeURIComponent(parts[0]),
      tab: 'pair',
      backlogAlbumId: null,
      albumId: null,
      subTab: null,
      discoverSource: 'global',
      discoverMode: 'browse',
      discoverQuery: '',
      discoverAlbumTab: 'summary',
      discoverReviewKeyword: '',
      pairA: decodeURIComponent(parts[3]),
      pairB: decodeURIComponent(parts[4]),
    };
  }
  const tab = VALID_TABS.has(parts[1]) ? parts[1] : 'today';
  const discoverSource = tab === 'discover' && parts[2] === 'user' ? 'user' : 'global';
  let backlogAlbumId = null;
  let discoverMode = 'browse';
  let discoverQuery = '';
  let discoverAlbumTab = 'summary';
  let discoverReviewKeyword = '';
  if (tab === 'discover') {
    const sourceOffset = discoverSource === 'user' ? 3 : 2;
    const firstDiscoverPart = parts[sourceOffset];
    if (discoverSource === 'user' && parts.length > 3 && !DISCOVER_PATH_TO_MODE[firstDiscoverPart]) {
      backlogAlbumId = decodeURIComponent(firstDiscoverPart);
      discoverAlbumTab = DISCOVER_ALBUM_TABS.has(parts[4]) ? parts[4] : 'summary';
      discoverReviewKeyword = discoverAlbumTab === 'reviews' && parts[5] ? decodeURIComponent(parts[5]) : '';
    } else if (discoverSource === 'global' && firstDiscoverPart && !DISCOVER_PATH_TO_MODE[firstDiscoverPart]) {
      backlogAlbumId = decodeURIComponent(firstDiscoverPart);
      discoverAlbumTab = DISCOVER_ALBUM_TABS.has(parts[3]) ? parts[3] : 'summary';
      discoverReviewKeyword = discoverAlbumTab === 'reviews' && parts[4] ? decodeURIComponent(parts[4]) : '';
    } else if (DISCOVER_PATH_TO_MODE[firstDiscoverPart]) {
      discoverMode = DISCOVER_PATH_TO_MODE[firstDiscoverPart];
      discoverQuery = discoverMode !== 'browse' && parts[sourceOffset + 1] ? decodeURIComponent(parts[sourceOffset + 1]) : '';
    }
  } else {
    backlogAlbumId = tab === 'backlog' && parts.length > 2 ? decodeURIComponent(parts[2]) : null;
  }
  const subTabIndex = backlogAlbumId ? 3 : 2;
  const subTab = (tab === 'today' || tab === 'backlog') && VALID_SUBTABS.has(parts[subTabIndex]) ? parts[subTabIndex] : null;
  return { projectName: decodeURIComponent(parts[0]), tab, backlogAlbumId, albumId: null, subTab, discoverSource, discoverMode, discoverQuery, discoverAlbumTab, discoverReviewKeyword, pairA: null, pairB: null };
}

export function getRouteFromLocation() {
  const hashParts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (hashParts.length) return parseRouteParts(hashParts);

  const parts = location.pathname.split('/').filter(Boolean).filter(p => p !== 'index.html');
  const idx = parts.indexOf(ROUTE_PREFIX);
  if (idx < 0 || parts.length <= idx + 1) return { projectName: null, tab: 'today', backlogAlbumId: null, albumId: null, subTab: null, discoverSource: 'global', discoverMode: 'browse', discoverQuery: '', discoverAlbumTab: 'summary', discoverReviewKeyword: '', pairA: null, pairB: null };
  return parseRouteParts(parts.slice(idx + 1));
}
export function pairRoutePath(projectName, a, b) {
  return `${APP_BASE}#/${encodeURIComponent(projectName)}/group/pair/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}
export function memberRoutePath(projectName, memberName) {
  return `${APP_BASE}#/${encodeURIComponent(projectName)}/group/member/${encodeURIComponent(memberName)}`;
}
export function routePath(projectName, tab = 'today', backlogAlbumId = null, subTab = null) {
  const base = `${APP_BASE}#/${encodeURIComponent(projectName)}`;
  if (tab === 'today') return `${base}/today${subTab ? `/${subTab}` : ''}`;
  if (tab === 'album' && backlogAlbumId) return `${base}/albums/${encodeURIComponent(backlogAlbumId)}${subTab ? `/${subTab}` : ''}`;
  if (tab === 'backlog' && backlogAlbumId) return `${base}/backlog/${encodeURIComponent(backlogAlbumId)}${subTab ? `/${subTab}` : ''}`;
  if (tab === 'discover' && backlogAlbumId) return `${base}/discover/${encodeURIComponent(backlogAlbumId)}`;
  return `${base}/${tab}`;
}
export function discoverModeRoutePath(projectName, source, mode, query = '') {
  const suffix = DISCOVER_MODE_TO_PATH[mode] || '';
  const querySuffix = suffix && query.trim() ? `/${encodeURIComponent(query.trim())}` : '';
  const sourcePrefix = source === 'user' ? '/user' : '';
  return `${APP_BASE}#/${encodeURIComponent(projectName)}/discover${sourcePrefix}${suffix ? `/${suffix}${querySuffix}` : ''}`;
}
export function discoverAlbumRoutePath(projectName, albumSlug, source = 'global', tab = 'summary', keyword = '') {
  const sourcePrefix = source === 'user' ? '/user' : '';
  const base = `${APP_BASE}#/${encodeURIComponent(projectName)}/discover${sourcePrefix}/${encodeURIComponent(albumSlug)}`;
  if (tab === 'reviews') return `${base}/reviews${keyword.trim() ? `/${encodeURIComponent(keyword.trim())}` : ''}`;
  if (tab === 'tracks') return `${base}/tracks`;
  return base;
}
export function discoverGenreStyleRoutePath(projectName, tag, source = 'global') {
  return discoverModeRoutePath(projectName, source, 'genre-style', tag);
}
export function readLastDiscoverPath(projectName) {
  try {
    const path = sessionStorage.getItem(`${LAST_DISCOVER_PATH_KEY}:${projectName}`);
    return path || routePath(projectName, 'discover');
  } catch (e) { return routePath(projectName, 'discover'); }
}
export function writeLastDiscoverPath(projectName, path) {
  try { sessionStorage.setItem(`${LAST_DISCOVER_PATH_KEY}:${projectName}`, path); } catch (e) {}
}
export function navigateTo(path) {
  location.assign(path);
}
export function navigateToProject(name) {
  navigateTo(routePath(name));
}
export function haptic(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}
export function navTab(tab) { return NAV_TAB_PARENT[tab] || tab; }
let _pendingVt = false;
let _pendingVtOut = null;
let _pendingVtIn = null;
export function setVtDirection(fromTab, toTab) {
  const a = TAB_ORDER[fromTab], b = TAB_ORDER[toTab];
  _pendingVt = a !== undefined && b !== undefined && a !== b;
}
export function navigateTab(path, { out: outAnim, in: inAnim } = {}) {
  _pendingVt = true;
  _pendingVtOut = outAnim || null;
  _pendingVtIn = inAnim || null;
  navigateTo(path);
}
export function navigateForward(path) {
  navigateTab(path, { out: 'vt-slide-out', in: 'vt-slide-in' });
}
export function navigateSubTab(path) {
  navigateTab(path, { out: 'vt-fade-out', in: 'vt-fade-in' });
}
export function navigateBack(path) {
  navigateTab(path, { out: 'vt-slide-back-out', in: 'vt-slide-back-in' });
}
// Reads and clears the pending view-transition direction/animation set by navigateTab et al.
// A getter+reset function (rather than exporting the raw _pendingVt* bindings) because ES module
// imports are read-only live bindings — a consumer can't do `import { _pendingVt } from ...` and
// then assign `_pendingVt = false` the way the original single-file code mutated the module-scope
// let directly.
export function consumePendingViewTransition() {
  const result = { isNavTransition: _pendingVt, outAnim: _pendingVtOut, inAnim: _pendingVtIn };
  _pendingVt = false;
  _pendingVtOut = null;
  _pendingVtIn = null;
  return result;
}
