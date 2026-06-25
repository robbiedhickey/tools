# Making a Desktop Web App Feel Native on Mobile (PWA)

Lessons learned converting a single-file Preact PWA from a desktop-first web app to something that genuinely feels like a native iOS/Android app. Ordered roughly by impact.

---

## 1. Bottom Tab Bar Navigation

**The single biggest change.** Move primary navigation from a top tab strip to a fixed bottom bar with icons + labels. This is where thumbs live on a phone.

```css
.bottom-nav {
  display: none; /* hidden on desktop */
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
  background: rgba(246, 245, 243, 0.88);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom); /* iPhone home indicator */
}
@media (max-width: 620px) {
  .bottom-nav { display: flex; }
  .tabs { display: none; } /* hide top tab strip */
  .page { padding-bottom: calc(60px + env(safe-area-inset-bottom)); } /* clear the nav */
}
```

Use **Material Symbols** (or any icon font already loaded) — `home`, `queue_music`, `group`, `person`. Keep 4–5 items max. Labels in `10px uppercase` beneath each icon.

**Frosted glass** (`backdrop-filter: blur + saturate`) is essential — without it the nav looks like a hard block, not an OS element. Both light and dark backgrounds need their own `rgba()` values.

---

## 2. Viewport Height in iOS Standalone PWA Mode

This is the most surprising platform bug. When your app is installed to the home screen, `100dvh` / `100vh` are computed incorrectly under `viewport-fit=cover` — iOS WebKit mis-handles the status bar region, so your root element ends up shorter than the actual window. Fixed bottom elements (like a bottom nav) stay pinned to the real bottom, leaving a gap.

**The fix:** chain `-webkit-fill-available` from `html → body → #app`. Declare `100dvh` first as the cross-browser fallback, then `-webkit-fill-available` — browsers that don't support it discard the line, iOS WebKit applies it.

```css
html { height: -webkit-fill-available; }

body {
  min-height: 100dvh;                 /* fallback */
  min-height: -webkit-fill-available; /* iOS standalone */
}

#app {
  display: flex; flex-direction: column;
  min-height: 100dvh;
  min-height: -webkit-fill-available;
}
```

Also ensure the flex chain all the way down to your page element works — every wrapper div between `#app` and your scrollable content needs `display: flex; flex-direction: column; flex: 1` so short-content pages fill the viewport rather than leaving dead space above the bottom nav.

```css
#app > div { display: flex; flex-direction: column; flex: 1; }
@media (max-width: 620px) { .page { flex: 1; } }
```

**Note:** `svh`, `lvh`, and `dvh` are all equally wrong in this case — they only differ by toolbar state, and standalone has no toolbars. The fix is `-webkit-fill-available`, not switching viewport units.

---

## 3. Directional Tab Transitions (View Transitions API)

Tab switches feel native when content slides directionally — right when going to a later tab, left when going back. The View Transitions API makes this possible with minimal code.

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes vt-out-left  { to   { transform: translateX(-28px); opacity: 0; } }
  @keyframes vt-in-right  { from { transform: translateX(28px);  opacity: 0; } }
  @keyframes vt-out-right { to   { transform: translateX(28px);  opacity: 0; } }
  @keyframes vt-in-left   { from { transform: translateX(-28px); opacity: 0; } }

  :root[data-vt="forward"] ::view-transition-old(root) { animation: vt-out-left  220ms ease both; }
  :root[data-vt="forward"] ::view-transition-new(root) { animation: vt-in-right  220ms ease both; }
  :root[data-vt="back"]    ::view-transition-old(root) { animation: vt-out-right 220ms ease both; }
  :root[data-vt="back"]    ::view-transition-new(root) { animation: vt-in-left   220ms ease both; }
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; }
}
```

Set the direction attribute **before** calling the navigation, then clean it up after the transition finishes:

```js
const TAB_ORDER = { today: 0, backlog: 1, group: 2, me: 3, activity: 4 };

function setVtDirection(fromTab, toTab) {
  const a = TAB_ORDER[fromTab], b = TAB_ORDER[toTab];
  if (a !== undefined && b !== undefined && a !== b) {
    document.documentElement.dataset.vt = b > a ? 'forward' : 'back';
  } else {
    delete document.documentElement.dataset.vt;
  }
}

// In your hashchange handler:
const t = document.startViewTransition(() => setRoute(newRoute));
t.finished.then(() => delete document.documentElement.dataset.vt);
```

Without the directional data attribute, the default cross-fade applies — a safe fallback for non-tab navigations.

---

## 4. Pull-to-Refresh

`overscroll-behavior-y: contain` disables the browser's native pull-to-refresh, which you want to prevent accidental refreshes — but you need to replace it with a deliberate gesture.

```js
function usePullToRefresh(onRefresh, enabled) {
  const [pullY, setPullY] = useState(0);
  const refs = useRef({ startY: null, pullY: 0, onRefresh });
  refs.current.onRefresh = onRefresh;
  const THRESHOLD = 64;

  useEffect(() => {
    if (!enabled) { setPullY(0); return; }
    const r = refs.current;
    const onTouchStart = (e) => {
      if (window.scrollY === 0) { r.startY = e.touches[0].clientY; r.pullY = 0; }
    };
    const onTouchMove = (e) => {
      if (r.startY === null) return;
      const dy = e.touches[0].clientY - r.startY;
      if (dy > 0 && window.scrollY === 0) {
        // sqrt curve gives rubber-band resistance feel
        const rubber = Math.min(Math.sqrt(dy) * 4, THRESHOLD * 1.5);
        r.pullY = rubber; setPullY(rubber);
      }
    };
    const onTouchEnd = () => {
      if (r.startY === null) return;
      if (r.pullY >= THRESHOLD) { haptic([10, 40, 20]); r.onRefresh(); }
      r.startY = null; r.pullY = 0; setPullY(0);
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled]);

  return pullY;
}
```

Key details:
- Only activate when `scrollY === 0` — otherwise it interferes with normal scrolling
- Use a **square-root resistance curve** (`Math.sqrt(dy) * 4`) — feels springy, not linear
- Store the callback in a ref so the effect doesn't re-register every render
- Show a circular indicator that rotates as the user pulls; turn it accent-colored at threshold
- Disable while already refreshing to prevent double-fires

---

## 5. Haptic Feedback

Android supports `navigator.vibrate()`; iOS does not (silently ignored). Wire it to every meaningful touch action — tabs, star ratings, submit success/error.

```js
function haptic(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// Usage patterns:
haptic(6);              // tab tap — barely perceptible
haptic(8);              // star selection — light pulse
haptic([10, 40, 20]);   // success — short-gap-short
haptic([30, 50, 30]);   // error — heavier pattern
```

Even though it only works on Android, it costs nothing on iOS and the patterns add real polish on devices that support it.

---

## 6. Press State Animations

Native apps give instant visual feedback on every tap. CSS `:active` with `transform: scale()` achieves this cheaply — it's GPU-composited and doesn't cause reflow.

```css
/* Navigation items */
.bottom-nav-item { transition: transform 0.08s, opacity 0.08s; }
.bottom-nav-item:active { transform: scale(0.88); opacity: 0.7; }

/* Buttons */
.pill-btn { transition: transform 0.08s, opacity 0.08s; }
.pill-btn:active:not(:disabled) { transform: scale(0.96); opacity: 0.85; }

/* Star rating — larger feedback for a more deliberate action */
.star-pick { transition: transform 0.1s; }
.star-pick:active { transform: scale(0.78); }
```

Keep the transition duration **under 100ms** — faster than this feels instant (good), slower starts feeling laggy.

---

## 7. Tab Icon Spring Bounce

When the active tab changes, animate the newly-active icon with a spring overshoot. Pure CSS, triggers automatically when the `.active` class is applied.

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes tab-pop {
    0%   { transform: scale(0.72); }
    60%  { transform: scale(1.18); }
    100% { transform: scale(1); }
  }
  .bottom-nav-item.active .bottom-nav-icon {
    animation: tab-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
}
```

The `cubic-bezier(0.34, 1.56, 0.64, 1)` is a spring curve — control points above 1.0 create the overshoot.

---

## 8. Input Attributes for Mobile Keyboards

These attributes make a meaningful difference on mobile and have zero cost on desktop.

```html
<!-- Username / identifier fields -->
<input
  autocapitalize="none"
  autocorrect="off"
  spellcheck="false"
  autocomplete="username"
  enterkeyhint="go"
/>

<!-- Multi-line text entry -->
<textarea
  enterkeyhint="enter"
  autocomplete="off"
></textarea>
```

- `enterkeyhint` changes the return key label on the software keyboard (`"go"`, `"search"`, `"send"`, `"enter"`, `"next"`, `"done"`)
- `autocapitalize="none"` prevents auto-capitalizing the first letter — critical for usernames
- `autocorrect="off"` prevents mangling technical input

---

## 9. Touch Interaction Polish

```css
/* Prevent long-press context menu on images and interactive elements */
.album-art { -webkit-touch-callout: none; }
.star-pick  { -webkit-touch-callout: none; user-select: none; }
.bottom-nav-item { -webkit-touch-callout: none; }

/* Tell the browser these elements handle their own touch — skip 300ms delay */
.bottom-nav-item { touch-action: manipulation; }
.pill-btn        { touch-action: manipulation; }

/* Contain scroll rubber-banding within the list, not the whole page */
.review-list { overscroll-behavior: contain; }
```

---

## 10. Performance Optimizations

```css
/* Skip rendering off-screen list items entirely */
.review-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 88px; /* estimated height for layout */
}
```

```html
<!-- Defer off-screen image decoding -->
<img loading="lazy" decoding="async" />
```

`content-visibility: auto` is the highest-ROI CSS performance property for long lists — the browser skips layout, paint, and compositing for off-screen items until they're about to scroll into view.

---

## 11. PWA Meta Tags

```html
<!-- Prevents white flash on dark-mode launch -->
<meta name="color-scheme" content="light dark">

<!-- Required for edge-to-edge layout with safe area insets -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

<!-- iOS home screen appearance -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

`viewport-fit=cover` is what enables your layout to extend under the iPhone notch and home indicator — essential for the bottom nav to reach the true screen edge. Pair with `env(safe-area-inset-bottom)` in CSS to pad content above the home indicator.

---

## 12. Safe Area Insets

The notch, Dynamic Island, and home indicator carve out regions the OS reserves. Use CSS env variables to respect them:

```css
/* Bottom nav sits behind home indicator; pad internally */
.bottom-nav { padding-bottom: env(safe-area-inset-bottom); }

/* Page content needs extra bottom padding to clear the nav + safe area */
.page { padding-bottom: calc(60px + env(safe-area-inset-bottom)); }

/* Toasts and FABs above the bottom nav */
.toast { bottom: calc(68px + env(safe-area-inset-bottom)); }
```

---

## 13. PWA Update Behavior

Without a service worker, iOS home screen PWAs cache aggressively at the OS level. Updates to your deployed files do **not** automatically propagate to an installed PWA. Users need to:

1. Delete the home screen icon
2. Open the URL in Safari (not via the icon) — this fetches the latest version
3. Re-add to home screen

If you want automatic updates, you need a service worker with a cache-busting strategy (e.g., network-first or stale-while-revalidate). Without one, treat the home screen PWA as a separate install that requires re-adding after significant updates.

---

## Summary Checklist

| Category | Change | Impact |
|---|---|---|
| Navigation | Bottom tab bar with icons | Very high |
| Layout | `-webkit-fill-available` height chain for iOS standalone | High |
| Transitions | Directional View Transitions on tab switch | High |
| Gesture | Pull-to-refresh with rubber-band resistance | High |
| Feedback | `navigator.vibrate()` haptics on key actions | Medium (Android only) |
| Feedback | `:active` scale transforms on all interactive elements | Medium |
| Feedback | Spring bounce on active tab icon | Medium |
| Input | `enterkeyhint`, `autocapitalize`, `autocorrect` on inputs | Medium |
| Touch | `-webkit-touch-callout: none` on images and controls | Low |
| Touch | `touch-action: manipulation` to remove 300ms tap delay | Low |
| Performance | `content-visibility: auto` on list items | Medium |
| Performance | `loading="lazy" decoding="async"` on images | Low |
| PWA | `color-scheme` meta to prevent white flash | Low |
| PWA | `viewport-fit=cover` + `env(safe-area-inset-*)` | High |
