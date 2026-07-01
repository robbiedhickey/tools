import { h, render } from 'preact';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { SITE_BASE } from './lib/constants.js';
import { readCurrentProjectName } from './lib/cache.js';
import { getRouteFromLocation, navigateTo, routePath, consumePendingViewTransition, navTab } from './lib/routing.js';
import { useSettings, useApplyTheme, SettingsContext } from './lib/settings.js';
import {
  useHub, useGroupMembers, useNotifications, deriveBacklog, findAlbumInHub, computeAlbumComparison,
  backlogEntryId,
} from './lib/hub.js';
import { Splash, RefreshErrorToast, Loading, ErrorCard, LankyPartyMascot, LoadingNote } from './components/common.js';
import { useAlbumPlayer, AlbumPlayerProvider, AlbumPlayerDock } from './components/player.js';
import { ExploreView, DiscoverAlbumView } from './components/explore.js';
import { TodayView, BacklogAlbumView, BacklogView, AlbumDetailView } from './components/views-album.js';
import { GroupView, ActivityView, PairDetailView, MeView, MemberView } from './components/views-group.js';
import { NameEntry, SettingsView } from './components/settings.js';
import { Nav, useSwipeNavigation, usePullToRefresh } from './components/nav.js';

const html = htm.bind(h);

// ---------- service worker registration ----------
if ('serviceWorker' in navigator) {
  try {
    navigator.serviceWorker.register('/1001-albums/sw.js', { scope: '/1001-albums/' });
  } catch { /* non-blocking */ }
}

function App() {
  const [route, setRoute] = useState(getRouteFromLocation());
  const { projectName, tab, backlogAlbumId, albumId, subTab, discoverSource, discoverMode, discoverQuery, discoverAlbumTab, discoverReviewKeyword, pairA, pairB, memberName } = route;
  const currentProjectName = !projectName ? readCurrentProjectName() : '';
  const userSettings = useSettings(projectName || currentProjectName || null);
  const { theme, diddy, musicService, players } = userSettings;
  const albumPlayer = useAlbumPlayer();
  useApplyTheme(theme);
  useSwipeNavigation();
  const pageRef = useRef(null);
  const scrollPositions = useRef({});
  const prevNavRef = useRef({ tab, backlogAlbumId, albumId });

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, []);


  useEffect(() => {
    const onNav = () => {
      // Save scroll for the view we're leaving before the transition resets window.scrollY.
      // Covers all navigation paths: tab switches, drill-in/out, swipe, inline links.
      if (!backlogAlbumId && !albumId) scrollPositions.current[tab] = window.scrollY;
      const newRoute = getRouteFromLocation();
      const { isNavTransition, outAnim, inAnim } = consumePendingViewTransition();
      if (outAnim) document.documentElement.style.setProperty('--vt-out', outAnim);
      else document.documentElement.style.removeProperty('--vt-out');
      if (inAnim) document.documentElement.style.setProperty('--vt-in', inAnim);
      else document.documentElement.style.removeProperty('--vt-in');
      if (isNavTransition && document.startViewTransition) {
        const t = document.startViewTransition(() => setRoute(newRoute));
        t.finished.then(() => {
          document.documentElement.style.removeProperty('--vt-out');
          document.documentElement.style.removeProperty('--vt-in');
        });
      } else {
        setRoute(newRoute);
      }
    };
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('hashchange', onNav);
    };
  }, [tab, backlogAlbumId, albumId]);

  useEffect(() => {
    if (projectName || !currentProjectName) return;
    navigateTo(routePath(currentProjectName));
  }, [projectName, currentProjectName]);

  // Manage scroll position across navigation like a native app:
  // - Tab switch: restore saved scroll for that tab (smooth)
  // - Drill into detail: instant reset (view transition animation covers it)
  // - Back out of detail: restore saved scroll for the parent tab (smooth)
  // - Filter/param change within a view: smooth reset to top
  useLayoutEffect(() => {
    const prev = prevNavRef.current;
    const wasTopLevel = !prev.backlogAlbumId && !prev.albumId;
    const isTopLevel = !backlogAlbumId && !albumId;
    const isDrillOut = !wasTopLevel && isTopLevel;
    const isTabSwitch = wasTopLevel && isTopLevel && prev.tab !== tab;

    if (isTabSwitch || isDrillOut) {
      window.scrollTo(0, scrollPositions.current[tab] ?? 0);
    } else {
      window.scrollTo(0, 0);
    }

    prevNavRef.current = { tab, backlogAlbumId, albumId };
  }, [tab, backlogAlbumId, albumId, discoverSource, discoverMode, discoverQuery, discoverAlbumTab, discoverReviewKeyword, pairA, pairB]);

  const hub = useHub(projectName);
  // Group/Activity/Pair/Member are the only views that need every member's full history — everyone
  // else gets by with just `me` + the group's own aggregate stats (see useHub/loadMe). Falling back
  // to just yourself keeps Today/Backlog's "group avg" comparison and the roster working (in
  // degraded form) before that fetch has ever run.
  const needsGroupMembers = ['group', 'activity', 'pair', 'member'].includes(tab);
  const groupMembers = useGroupMembers(projectName, hub.data?.group, needsGroupMembers);
  const members = groupMembers.members || (hub.data ? { [projectName]: hub.data.me } : {});
  const hubWithMembers = hub.data ? { ...hub.data, members } : null;
  const notifications = useNotifications(projectName);
  const PTR_THRESHOLD = 64;
  const pullY = usePullToRefresh(hub.refresh, hub.status === 'ready' && !hub.refreshing, pageRef);
  const pullProgress = Math.min(pullY / PTR_THRESHOLD, 1);
  const pagePullY = pullY > 0 ? Math.min(pullY * 0.65, 68) : 0;

  // Splash: show until hub has a final (non-refreshing) state for the first time.
  // useState lazy initializer captures the synchronous initial hub state so that
  // a fresh-cache load never shows the splash at all.
  const hubSettled = (hub.status === 'ready' && !hub.refreshing) || hub.status === 'error';
  const [splashDone, setSplashDone] = useState(() => hubSettled);
  useEffect(() => { if (hubSettled) setSplashDone(true); }, [hubSettled]);
  const splashRefreshing = !splashDone && hub.status === 'ready' && hub.refreshing;

  useEffect(() => {
    if (!players.enabled && albumPlayer.player) albumPlayer.closePlayer();
  }, [players.enabled, albumPlayer.player]);

  if (!projectName && currentProjectName) return null;
  if (!projectName) return html`<${NameEntry} theme=${theme} />`;

  const backlog = hub.data ? deriveBacklog(hub.data.me) : [];
  const backlogEntry = backlogAlbumId
    ? backlog.find(e => backlogEntryId(e) === backlogAlbumId)
    : null;
  const albumRecord = hubWithMembers && albumId ? findAlbumInHub(hubWithMembers, albumId) : null;
  const groupSlug = hub.data && hub.data.group ? hub.data.group.slug : null;
  const todayAlbumId = tab === 'today' && hub.data && hub.data.me.currentAlbum ? hub.data.me.currentAlbum.uuid : null;
  const activeAlbumId = albumId || (backlogEntry && backlogEntry.album ? backlogEntry.album.uuid : null) || todayAlbumId;
  const comparison = hubWithMembers && activeAlbumId
    ? computeAlbumComparison(hubWithMembers, activeAlbumId, projectName, backlogEntry ? backlogEntry.globalRating : (albumRecord ? albumRecord.globalRating : null))
    : null;

  return html`
    <${SettingsContext.Provider} value=${userSettings}>
    <div class=${`app-shell ${albumPlayer.player ? 'has-player' : ''}`}>
      <${Splash} ready=${splashDone} refreshing=${splashRefreshing} />
      <${Nav} projectName=${projectName} tab=${navTab(tab === 'album' ? (subTab === 'group' ? 'group' : 'today') : tab)} backlogCount=${backlog.length} unreadCount=${notifications.notifications.length} theme=${theme} scrollToTop=${scrollToTop} />
      <${RefreshErrorToast} error=${hub.refreshError} onDismiss=${hub.dismissRefreshError} />
      ${pullY > 0 && html`
        <div class="ptr-indicator" style=${{
          transform: `translate(-50%, ${pullProgress * 52 - 52 + pagePullY * 0.2}px)`,
          opacity: pullProgress,
        }}>
          <span class="icon-symbol" style=${{
            display: 'block',
            transform: `rotate(${pullProgress * 240}deg)`,
            color: pullY >= PTR_THRESHOLD ? 'var(--accent)' : 'var(--text-dim)',
          }}>refresh</span>
        </div>
      `}
      <main ref=${pageRef} class=${`page ${pullY > 0 ? 'is-pulling' : ''}`} style=${pullY > 0 ? { transform: `translateY(${pagePullY}px)` } : undefined}>
        ${tab === 'settings' && html`<${SettingsView} me=${hub.data?.me ?? null} projectName=${projectName} theme=${theme} diddy=${diddy} musicService=${musicService} players=${players} />`}
        ${tab === 'discover' && !backlogAlbumId && html`<${ExploreView} projectName=${projectName} source=${discoverSource || 'global'} mode=${discoverMode || 'browse'} initialQuery=${discoverQuery || ''} />`}
        ${tab === 'discover' && backlogAlbumId && html`<${DiscoverAlbumView} albumSlug=${backlogAlbumId} projectName=${projectName} source=${discoverSource || 'global'} hubData=${hub.data} initialTab=${discoverAlbumTab || 'summary'} reviewKeyword=${discoverReviewKeyword || ''} />`}
        ${tab !== 'settings' && tab !== 'discover' && hub.status === 'loading' && html`<${Loading} />`}
        ${tab !== 'settings' && tab !== 'discover' && hub.status === 'error' && html`<${ErrorCard} error=${hub.error} projectName=${projectName} onRetry=${hub.refresh} />`}
        ${tab !== 'settings' && tab !== 'discover' && hub.status === 'ready' && html`
          <div class="status-row">
            ${hub.refreshing
              ? html`<span><${LankyPartyMascot} />Refreshing…</span>`
              : html`<span>${hub.stale ? 'Showing cached data' : `Updated ${new Date(hub.fetchedAt).toLocaleTimeString()}`}</span>`}
            <a href="#" onClick=${(e) => { e.preventDefault(); hub.refresh(); }}>Refresh</a>
          </div>
          ${tab === 'today' && html`<${TodayView} projectName=${projectName} me=${hub.data.me} backlog=${backlog} subTab=${subTab} comparison=${comparison} />`}
          ${tab === 'backlog' && (backlogAlbumId
            ? html`<${BacklogAlbumView} projectName=${projectName} entry=${backlogEntry} groupSlug=${groupSlug} comparison=${comparison} subTab=${subTab} onRated=${() => { Promise.resolve(hub.refresh()).then(() => navigateTo(routePath(projectName, 'backlog'))); }} />`
            : html`<${BacklogView} projectName=${projectName} backlog=${backlog} members=${members} />`
          )}
          ${tab === 'album' && html`<${AlbumDetailView} projectName=${projectName} albumRecord=${albumRecord} groupSlug=${groupSlug} comparison=${comparison} subTab=${subTab} />`}
          ${needsGroupMembers && groupMembers.status === 'loading' && html`<${LoadingNote} label="Loading group roster…" />`}
          ${needsGroupMembers && groupMembers.status === 'error' && html`<${ErrorCard} error=${groupMembers.error} projectName=${projectName} onRetry=${groupMembers.refresh} />`}
          ${needsGroupMembers && groupMembers.status === 'ready' && html`
            <div class="status-row">
              ${groupMembers.refreshing
                ? html`<span><${LankyPartyMascot} />Refreshing…</span>`
                : html`<span>${groupMembers.stale ? 'Showing cached group data' : `Group data updated ${new Date(groupMembers.fetchedAt).toLocaleTimeString()}`}</span>`}
              <a href="#" onClick=${(e) => { e.preventDefault(); groupMembers.refresh(); }}>Refresh</a>
            </div>
            ${tab === 'group' && html`<${GroupView} group=${hub.data.group} members=${members} projectName=${projectName} />`}
            ${tab === 'activity' && html`<${ActivityView} members=${members} projectName=${projectName} group=${hub.data.group} notifications=${notifications} />`}
            ${tab === 'pair' && html`<${PairDetailView} projectName=${projectName} members=${members} pairA=${pairA} pairB=${pairB} />`}
            ${tab === 'member' && html`<${MemberView} memberName=${memberName} project=${members[memberName]} projectName=${projectName} />`}
          `}
          ${tab === 'me' && html`<${MeView} me=${hub.data.me} projectName=${projectName} />`}
        `}
        <p class="footer-note">
          Built for lankyserv <${LankyPartyMascot} /> Unofficial companion to 1001albumsgenerator.com
          ${' · '}<a class="real-site-link" href=${`${SITE_BASE}/${encodeURIComponent(projectName)}`} target="_blank" rel="noopener">Open real site ↗</a>
        </p>
      </main>
      <${AlbumPlayerDock} />
    </div>
    <//>
  `;
}

function AppRoot() {
  const localSettings = useSettings(null);
  return html`
      <${SettingsContext.Provider} value=${localSettings}>
        <${AlbumPlayerProvider} musicService=${localSettings.musicService}>
          <${App} />
        <//>
      <//>
  `;
}

render(html`<${AppRoot} />`, document.getElementById('app'));
