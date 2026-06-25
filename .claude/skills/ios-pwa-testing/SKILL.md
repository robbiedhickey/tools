---
name: ios-pwa-testing
description: Use when debugging or validating iOS Safari Add to Home Screen / standalone PWA layout issues, especially bugs that do not reproduce in desktop responsive mode or Chrome headless. Covers local LAN testing on a real iPhone, Safari/WebKit inspection, and common standalone viewport/safe-area checks for this repo's 1001-albums PWA.
---

# iOS PWA Testing

Use this when a mobile bug is reported specifically in an installed iOS PWA, Safari Add to Home
Screen app, or `display: standalone` mode. Do not assume Chrome responsive mode proves the fix.

## Core rule

Installed iOS PWAs run in Safari/WebKit standalone mode. Desktop Chrome, Chrome headless, and
desktop responsive mode can catch ordinary CSS overflow, but they do not faithfully reproduce:

- `viewport-fit=cover` safe-area behavior
- standalone status bar and home indicator sizing
- `100vh` / `100dvh` / `-webkit-fill-available` quirks
- visual viewport vs layout viewport differences
- fixed bottom UI around `env(safe-area-inset-bottom)`

Use browser automation for quick regressions, but validate the final claim on a real iPhone PWA
or iOS Simulator when the issue is standalone-specific.

macOS Safari is useful for desktop WebKit checks, but it is not the same runtime as an iOS
home-screen PWA. Use it as an intermediate signal, not final validation for standalone bugs.

## Quick local workflow

1. Start a local server reachable by the iPhone:

```bash
npm run dev:static -- --listen 4173
```

Use the printed LAN URL, for example `http://192.168.x.x:4173/1001-albums/`.

2. On iPhone Safari, open the LAN URL.
3. Use Share -> Add to Home Screen.
4. Launch from the home screen, not from Safari.
5. Navigate to the problem route, for example:

```text
/1001-albums/#/hodorswit/me
/1001-albums/#/hodorswit/backlog
```

For 1001-albums test data:

- `hodorswit`: good for Today, Group, Me, Activity, and a short/empty Backlog case.
- `emmerson-hickey`: good for a large Backlog table.

## Debugging with Safari Web Inspector

If inspection is needed:

1. Enable iPhone Settings -> Safari -> Advanced -> Web Inspector.
2. Connect the iPhone to the Mac.
3. Open macOS Safari -> Develop -> iPhone -> select the installed PWA page.
4. Inspect computed styles and run console probes against the standalone app.

Useful console probes:

```js
({
  innerWidth,
  innerHeight,
  clientWidth: document.documentElement.clientWidth,
  clientHeight: document.documentElement.clientHeight,
  scrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  standalone: navigator.standalone,
  displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
  visualViewport: visualViewport && {
    width: visualViewport.width,
    height: visualViewport.height,
    offsetTop: visualViewport.offsetTop,
    offsetLeft: visualViewport.offsetLeft
  }
})
```

Find horizontal overflow offenders:

```js
[...document.querySelectorAll('body *')]
  .map(el => {
    const r = el.getBoundingClientRect();
    return {
      el,
      tag: el.tagName,
      className: String(el.className),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    };
  })
  .filter(x =>
    x.right > document.documentElement.clientWidth + 1 ||
    x.left < -1 ||
    x.scrollWidth > x.clientWidth + 1
  );
```

Check bottom nav geometry:

```js
(() => {
  const nav = document.querySelector('.bottom-nav');
  const page = document.querySelector('.page');
  const nr = nav.getBoundingClientRect();
  return {
    navDisplay: getComputedStyle(nav).display,
    navHeight: nr.height,
    navTop: nr.top,
    navBottom: nr.bottom,
    pagePaddingBottom: getComputedStyle(page).paddingBottom
  };
})();
```

If safe-area sizing looks wrong, temporarily override the app's safe-area CSS variable (when one
exists) or add a one-off style in Web Inspector to simulate a bad inset. A robust nav should stay
bounded when the bottom inset is unexpectedly large.

## Common fixes to inspect first

For this repo's PWA layout, check these before broader rewrites:

- Mobile overrides must appear after base shorthand declarations. A later `.page { padding: ... }`
  will overwrite an earlier mobile `padding-bottom`.
- Fixed bottom nav should have explicit content height plus safe-area padding, for example
  `height: calc(58px + var(--safe-area-bottom-capped))`, with fixed item height.
- Do not blindly trust raw `env(safe-area-inset-bottom)` in standalone mode. Cap it with a CSS
  variable, for example `--safe-area-bottom-capped: min(env(safe-area-inset-bottom), 34px);`.
  This prevents WebKit from turning a fixed bottom nav into a giant block if the reported inset
  is wrong.
- If the bottom nav is still oversized in the installed PWA, use the blunt fix: remove bottom
  safe-area from that nav path entirely. Set a fixed nav height, `padding-bottom: 0`, and a fixed
  page clearance such as `74px`. A slightly lower nav is better than an unusably tall one.
- Page content needs bottom padding at least nav height plus safe area.
- `html`, `body`, `#app`, and wrappers between `#app` and `.page` need a working flex/min-height
  chain for short pages.
- Use `min-width: 0` on flex/grid children and `minmax(0, 1fr)` for shrinkable grid columns.
- Wide tables should sit inside a horizontal scroll wrapper instead of defining page width.
- Avoid global `overflow-x: hidden` as the only fix. It can hide the symptom while leaving fixed
  UI or tap targets misaligned. Use it only with targeted containment and verified geometry.

## Pull to refresh

Custom pull-to-refresh in iOS standalone is fragile. The browser's rubber-band gesture and passive
touch listeners can swallow the app's gesture unless the app takes control after recognizing a
top-of-page downward pull.

Preferred implementation shape:

- Track the actual document scroller, not only `window.scrollY`.
- Treat `scrollTop <= 2` as top-of-page; exact zero is too brittle on iOS.
- `touchstart` can stay passive, but `touchmove` must be non-passive if the app will call
  `preventDefault()` after recognizing the pull.
- Only call `preventDefault()` after a small downward threshold so normal scrolling remains native.
- Handle `touchcancel` and reset state.
- Put the indicator below the status-bar safe area.

UX caveat: preventing the native rubber-band makes refresh reliable but can feel "locked" if only
a floating spinner moves. For a more native feel, either translate the page content down with the
pull distance or deliberately accept a simpler overlay-style refresh indicator. Do not claim it
feels native unless the installed iOS PWA was tested by hand.

Avoid "tap active bottom tab to refresh" for apps backed by rate-limited APIs. It is easy to trigger
accidental refreshes and burn through a limit.

## Validation standard

For standalone-specific reports, a fix is not fully verified until at least one of these is true:

- tested in an installed iOS home-screen PWA on a real device
- tested in iOS Simulator Safari/home-screen equivalent, if available
- the user confirms the installed PWA behavior after deploy

When only desktop/headless checks were run, say so explicitly and describe them as partial
validation.
