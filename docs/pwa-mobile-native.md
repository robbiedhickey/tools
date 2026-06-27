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

## 3. Page Transitions (View Transitions API)

Top-level navigation feels native when it animates. The View Transitions API makes this possible with minimal code, but there are important gotchas.

### The key gotcha: CSS scoping doesn't work

The intuitive approach — setting a `data-vt` attribute on `:root` and scoping CSS rules with `:root[data-vt] ::view-transition-old(root)` — **does not work**. The `::view-transition-*` pseudo-elements live in a special rendering layer and are not true CSS descendants of `:root`, so ancestor/descendant combinators never match them.

**Don't do this:**
```css
/* This selector never matches — ::view-transition-old is not a real descendant */
:root[data-vt="forward"] ::view-transition-old(root) { animation: ...; }
```

CSS custom properties **do** inherit into `::view-transition-*` via `var()`, so you can use them to swap animation names without scoping selectors.

### The correct approach: opt in via JS, not CSS

Control which navigations animate by conditionally calling `startViewTransition`. Navigations that call it get animated; others get an instant update. Use `var()` with defaults to support per-navigation animation variants.

```css
@media (prefers-reduced-motion: no-preference) {
  /* Tab switch — vertical rise */
  @keyframes vt-out { to   { opacity: 0; transform: translateY(-16px); } }
  @keyframes vt-in  { from { opacity: 0; transform: translateY(24px);  } }
  /* Forward drill — slide right */
  @keyframes vt-slide-out      { to   { opacity: 0; transform: translateX(-28px); } }
  @keyframes vt-slide-in       { from { opacity: 0; transform: translateX(28px);  } }
  /* Back — slide left */
  @keyframes vt-slide-back-out { to   { opacity: 0; transform: translateX(28px);  } }
  @keyframes vt-slide-back-in  { from { opacity: 0; transform: translateX(-28px); } }
  /* Sub-tab / filter — subtle fade, barely any movement */
  @keyframes vt-fade-out { to   { opacity: 0; transform: scale(0.99); } }
  @keyframes vt-fade-in  { from { opacity: 0; transform: scale(0.99); } }

  ::view-transition-old(root) { animation: var(--vt-out, vt-out) 220ms ease-out both; }
  ::view-transition-new(root) { animation: var(--vt-in,  vt-in)  220ms ease-out both; }
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; }
}
```

```js
// Module-level state — avoids race conditions with t.finished cleanup
let _pendingVt = false;
let _pendingVtOut = null;
let _pendingVtIn = null;

function navigateTo(path) { location.assign(path); }

// Core: set animation variant and trigger
function navigatePage(path, { out: outAnim, in: inAnim } = {}) {
  _pendingVt = true;
  _pendingVtOut = outAnim || null;
  _pendingVtIn  = inAnim  || null;
  navigateTo(path);
}

// Navigation vocabulary — use the right one at every call site:
function navigateTab(path)    { navigatePage(path); }                                                        // top nav bar tabs — vertical rise
function navigateForward(path){ navigatePage(path, { out: 'vt-slide-out',      in: 'vt-slide-in'      }); } // drill into a screen — slides right
function navigateBack(path)   { navigatePage(path, { out: 'vt-slide-back-out', in: 'vt-slide-back-in' }); } // back buttons — slides left
function navigateSubTab(path) { navigatePage(path, { out: 'vt-fade-out',       in: 'vt-fade-in'       }); } // sub-tabs and filters — subtle fade

// Hashchange handler reads and clears flags atomically
const onNav = () => {
  const newRoute = getRouteFromLocation();
  const isNavTransition = _pendingVt;
  const outAnim = _pendingVtOut;
  const inAnim  = _pendingVtIn;
  _pendingVt = false; _pendingVtOut = null; _pendingVtIn = null;
  if (outAnim) document.documentElement.style.setProperty('--vt-out', outAnim);
  else         document.documentElement.style.removeProperty('--vt-out');
  if (inAnim)  document.documentElement.style.setProperty('--vt-in',  inAnim);
  else         document.documentElement.style.removeProperty('--vt-in');
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
```

### Navigation vocabulary guidelines

Every navigation in the app should use the right helper. The goal is to match the animation to the user's mental model of where they are in the hierarchy.

| Helper | Animation | When to use |
|---|---|---|
| `navigateTo` | None (instant) | Truly stateless updates — URL-encoded state changes like search queries where a flash would be jarring |
| `navigateTab` | Vertical rise | Tapping a top-level nav bar item |
| `navigateForward` | Slide right | Clicking any card, row, or link that drills into a new screen |
| `navigateSubTab` | Subtle fade (scale 0.99) | Switching tabs within a screen, toggling modes, swapping filter views |
| `navigateBack` | Slide left | Any "← Back to X" button in a banner or header |

**Opinion**: when in doubt, `navigateForward` is almost always correct for a tap on something that reveals new content. Reserve `navigateTo` for filter/state changes where the screen title doesn't change and content updates in place.

**Back button copy convention**: back buttons should read `← Back to [place]` with the arrow at the start. Forward shortcuts to a top-level tab (e.g. "View backlog →") should use `navigateTab`, not `navigateForward` or `navigateBack` — the arrow at the end signals it's a tab jump, not a drill-in.

### Why the module-level flag instead of setting an attribute?

Setting `document.documentElement.dataset.vt` before `location.assign()` looks correct but has a race: if a previous transition's `t.finished` promise resolves after you set the attribute (but before the new transition starts), it deletes the value you just set. The module-level flag is read and cleared atomically at the start of the hashchange handler, eliminating the race.

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
