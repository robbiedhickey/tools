import { h, Fragment } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { routePath, navigateTab, setVtDirection, navTab, haptic } from '../lib/routing.js';
import { LankyMascot } from './common.js';

const html = htm.bind(h);

// ---------- nav ----------
export function Nav({ projectName, tab, backlogCount, unreadCount, theme, scrollToTop }) {
  const topTabs = [
    { id: 'today', label: 'Today' },
    { id: 'backlog', label: `Backlog${backlogCount ? ` (${backlogCount})` : ''}` },
    { id: 'group', label: 'Group' },
    { id: 'me', label: 'Me' },
  ];
  const bottomTabs = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'backlog', label: 'Backlog', icon: 'queue_music', badge: backlogCount },
    { id: 'group', label: 'Group', icon: 'group' },
    { id: 'me', label: 'Me', icon: 'person' },
  ];
  // The tab strip scrolls horizontally on narrow screens (it no longer wraps), so without this
  // the active tab can land scrolled out of view on load — e.g. opening straight to Me shows
  // just a sliver of its solid accent fill at the right edge instead of the "Me" label.
  const tabsRef = useRef(null);
  useEffect(() => {
    const active = tabsRef.current && tabsRef.current.querySelector('.tab.active');
    if (active) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [tab]);
  return html`
    <${Fragment}>
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href=${routePath(projectName, 'today')} onClick=${(e) => { e.preventDefault(); if (navTab(tab) === 'today') { scrollToTop(); return; } navigateTab(routePath(projectName, 'today')); }}><${LankyMascot} /><span class="brand-text">1001 Albums Kongsole</span><span class="brand-text-mobile">Kongsole</span></a>
          <nav class="tabs" ref=${tabsRef}>
            ${topTabs.map((t, i) => html`
              ${i > 0 && html`<span class="tab-sep">|</span>`}
              <a class=${`tab ${navTab(tab) === t.id ? 'active' : ''}`} href=${routePath(projectName, t.id)} onClick=${(e) => { e.preventDefault(); if (navTab(tab) === t.id) { scrollToTop(); return; } setVtDirection(tab, t.id); navigateTab(routePath(projectName, t.id)); }}>${t.label}</a>
            `)}
          </nav>
          <div class="nav-actions">
            <button
              class=${`bell-link ${tab === 'discover' ? 'active' : ''}`}
              type="button"
              aria-label="Explore albums"
              title="Explore albums"
              onClick=${() => { if (navTab(tab) === 'discover') { scrollToTop(); return; } setVtDirection(tab, 'discover'); navigateTab(routePath(projectName, 'discover')); }}
            >
              <span class="icon-symbol">search</span>
            </button>
            <a
              class=${`bell-link ${tab === 'activity' ? 'active' : ''}`}
              href=${routePath(projectName, 'activity')}
              onClick=${(e) => { e.preventDefault(); if (tab === 'activity') { scrollToTop(); return; } setVtDirection(tab, 'activity'); navigateTab(routePath(projectName, 'activity')); }}
              aria-label=${`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              title="Recent activity"
            >
              <span class="icon-symbol">notifications</span>${unreadCount > 0 && html`<span class="bell-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>`}
            </a>
            <a
              class=${`bell-link ${tab === 'settings' ? 'active' : ''}`}
              href=${routePath(projectName, 'settings')}
              onClick=${(e) => { e.preventDefault(); if (tab === 'settings') { scrollToTop(); return; } setVtDirection(tab, 'settings'); navigateTab(routePath(projectName, 'settings')); }}
              aria-label="Settings"
              title="Settings"
            >
              <span class="icon-symbol">settings</span>
            </a>
          </div>
        </div>
      </header>
      <nav
        class="bottom-nav"
        aria-label="Main navigation"
        style=${{ height: '58px', minHeight: '58px', maxHeight: '58px', padding: 0 }}
      >
        ${bottomTabs.map(t => html`
          <a
            class=${`bottom-nav-item ${navTab(tab) === t.id ? 'active' : ''}`}
            style=${{ height: '58px', minHeight: '58px', maxHeight: '58px' }}
            href=${routePath(projectName, t.id)}
            onClick=${(e) => { e.preventDefault(); haptic(6); if (navTab(tab) === t.id) { scrollToTop(); return; } setVtDirection(tab, t.id); navigateTab(routePath(projectName, t.id)); }}
            aria-label=${t.badge ? `${t.label}, ${t.badge} items` : t.label}
            aria-current=${navTab(tab) === t.id ? 'page' : undefined}
          >
            <span class="bottom-nav-icon" aria-hidden="true">${t.icon}</span>
            <span class="bottom-nav-label">${t.label}</span>
            ${t.badge > 0 && html`<span class="bell-badge" style="top:4px;right:calc(50% - 18px)">${t.badge > 99 ? '99+' : t.badge}</span>`}
          </a>
        `)}
      </nav>
    </${Fragment}>
  `;
}

export function useSwipeNavigation() {
  useEffect(() => {
    const EDGE = 32;       // px from screen edge to start tracking
    const MIN_DIST = 55;   // minimum horizontal travel to commit
    const MAX_SLOPE = 0.6; // |dy/dx| must be below this (≈31° off horizontal)
    const r = { startX: null, startY: null, tracking: false, dir: 0 };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const fromLeft = x < EDGE;
      const fromRight = x > window.innerWidth - EDGE;
      if (!fromLeft && !fromRight) return;
      r.startX = x;
      r.startY = e.touches[0].clientY;
      r.dir = fromLeft ? 1 : -1; // 1 = swiping right (back), -1 = swiping left (forward)
      r.tracking = true;
    };

    const onTouchMove = (e) => {
      if (!r.tracking) return;
      const dx = e.touches[0].clientX - r.startX;
      const dy = e.touches[0].clientY - r.startY;
      if (Math.sign(dx) !== r.dir || Math.abs(dy) > Math.abs(dx) * MAX_SLOPE) {
        r.tracking = false;
        return;
      }
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = (e) => {
      if (!r.tracking) { r.tracking = false; return; }
      r.tracking = false;
      const dx = e.changedTouches[0].clientX - r.startX;
      const dy = e.changedTouches[0].clientY - r.startY;
      if (Math.abs(dx) < MIN_DIST || Math.abs(dy) > Math.abs(dx) * MAX_SLOPE) return;
      if (r.dir === 1) history.back();
      else history.forward();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', () => { r.tracking = false; });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);
}

export function usePullToRefresh(onRefresh, enabled, scrollRef) {
  const [pullY, setPullY] = useState(0);
  const refs = useRef({ startY: null, pullY: 0, pulling: false, onRefresh });
  refs.current.onRefresh = onRefresh;
  const THRESHOLD = 64;
  useEffect(() => {
    if (!enabled) { setPullY(0); return; }
    const r = refs.current;
    const scrollTop = () => {
      if (scrollRef && scrollRef.current && scrollRef.current.scrollHeight > scrollRef.current.clientHeight + 1) {
        return scrollRef.current.scrollTop || 0;
      }
      const scroller = document.scrollingElement || document.documentElement;
      return Math.max(window.scrollY || 0, scroller.scrollTop || 0, document.body.scrollTop || 0);
    };
    const atTop = () => scrollTop() <= 2;
    const reset = () => {
      r.startY = null;
      r.pullY = 0;
      r.pulling = false;
      setPullY(0);
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 1 && atTop()) {
        r.startY = e.touches[0].clientY;
        r.pullY = 0;
        r.pulling = false;
      }
    };
    const onTouchMove = (e) => {
      if (r.startY === null) return;
      const dy = e.touches[0].clientY - r.startY;
      if (dy <= 0) {
        reset();
        return;
      }
      if (!r.pulling && !atTop()) {
        reset();
        return;
      }
      if (dy < 6) return;
      r.pulling = true;
      if (e.cancelable) e.preventDefault();
      const rubber = Math.min(Math.sqrt(dy) * 5.5, THRESHOLD * 1.8);
      r.pullY = rubber;
      setPullY(rubber);
    };
    const onTouchEnd = () => {
      if (r.startY === null) return;
      if (r.pullY >= THRESHOLD) { haptic([10, 40, 20]); r.onRefresh(); }
      reset();
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', reset);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', reset);
    };
  }, [enabled, scrollRef]);
  return pullY;
}
