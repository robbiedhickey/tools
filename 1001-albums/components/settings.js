import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { APP_BASE, DIDDY_GIF_URL } from '../lib/constants.js';
import { navigateToProject } from '../lib/routing.js';
import { loadPushPrefs, subscribePush, unsubscribePush, localHourToUtcHour } from '../lib/push.js';
import { LankyMascot } from './common.js';
import { MusicServicePreferencePicker } from './player.js';

const html = htm.bind(h);

export function NameEntry({ theme }) {
  const [name, setName] = useState('');
  const go = (e) => { e.preventDefault(); if (name.trim()) navigateToProject(name.trim()); };
  return html`
    <main class="name-entry">
      <div class="name-entry-toggle"><${ThemeToggle} theme=${theme.theme} toggle=${theme.toggle} /></div>
      <h1><${LankyMascot} />1001 Albums Kongsole</h1>
      <p class="muted">Enter your 1001albumsgenerator.com username to get started.</p>
      <form onSubmit=${go}>
        <input value=${name} onInput=${e => setName(e.target.value)} placeholder="Username" autofocus
          autocapitalize="none" autocorrect="off" spellcheck="false"
          autocomplete="username" enterkeyhint="go" />
        <button type="submit">Go</button>
      </form>
    </main>
  `;
}

// ---------- settings view ----------
export function SettingsView({ me, projectName, theme, diddy, musicService, players }) {
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const iosNotInstalled = isIos && !isStandalone;

  const [prefs, setPrefs] = useState(null);
  const [localHour, setLocalHour] = useState(9);
  const [toggling, setToggling] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    if (!projectName || !pushSupported) return;
    loadPushPrefs(projectName).then((p) => {
      setPrefs(p);
      if (p.notifyAtUtc != null) {
        // Convert stored UTC hour back to a rough local hour for display
        const d = new Date();
        d.setUTCHours(p.notifyAtUtc, 0, 0, 0);
        setLocalHour(d.getHours());
      }
    });
  }, [projectName]);

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    setPushError('');
    try {
      if (prefs?.subscribed) {
        await unsubscribePush(projectName);
        setPrefs((p) => ({ ...p, subscribed: false }));
      } else {
        const utcHour = localHourToUtcHour(localHour);
        await subscribePush(projectName, utcHour, me?.currentAlbum?.uuid ?? null);
        setPrefs((p) => ({ ...p, subscribed: true, notifyAtUtc: utcHour }));
      }
    } catch (e) {
      setPushError(e.message || 'Something went wrong');
    } finally {
      setToggling(false);
    }
  };

  const handleHourChange = async (e) => {
    const h = Number(e.target.value);
    setLocalHour(h);
    if (prefs?.subscribed) {
      const utcHour = localHourToUtcHour(h);
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const j = sub.toJSON();
          await fetch(`${APP_BASE}api/push/${encodeURIComponent(projectName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, notifyAtUtc: utcHour, prefs: prefs.prefs ?? { new_album: true }, currentAlbumUuid: null }),
          });
        }
      } catch { /* non-blocking */ }
      setPrefs((p) => ({ ...p, notifyAtUtc: utcHour }));
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => {
    const label = new Date(0, 0, 0, i).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { value: i, label };
  });

  return html`
    <div class="settings-view">

      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>
        <div class="card">
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">Theme</div>
              <div class="settings-row-desc">Choose light or dark mode</div>
            </div>
            <div class="theme-picker" role="group" aria-label="Theme">
              <button
                type="button"
                class=${`theme-option ${theme.theme === 'light' ? 'active' : ''}`}
                onClick=${() => theme.theme !== 'light' && theme.toggle()}
                aria-pressed=${theme.theme === 'light'}
              ><span class="icon-symbol">light_mode</span> Light</button>
              <button
                type="button"
                class=${`theme-option ${theme.theme === 'dark' ? 'active' : ''}`}
                onClick=${() => theme.theme !== 'dark' && theme.toggle()}
                aria-pressed=${theme.theme === 'dark'}
              ><span class="icon-symbol">dark_mode</span> Dark</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Music</div>
        <div class="card">
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">Preferred service</div>
              <div class="settings-row-desc">Choose the player used when both services are available</div>
            </div>
            <${MusicServicePreferencePicker} musicService=${musicService} />
          </div>
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">Embeddable players</div>
              <div class="settings-row-desc">Show Apple and Spotify players inside the app</div>
            </div>
            <button
              type="button"
              class=${`toggle-btn ${players.enabled ? 'on' : ''}`}
              onClick=${players.toggle}
              aria-pressed=${players.enabled}
            >${players.enabled ? 'On' : 'Off'}</button>
          </div>
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">
                Recommendations
                <img src=${DIDDY_GIF_URL} alt="" style=${{ height: '22px', width: 'auto', verticalAlign: 'middle' }} />
              </div>
              <div class="settings-row-desc">Similar album suggestions from Diddy Kong</div>
            </div>
            <button
              type="button"
              class=${`toggle-btn ${diddy.enabled ? 'on' : ''}`}
              onClick=${diddy.toggle}
              aria-pressed=${diddy.enabled}
            >${diddy.enabled ? 'On' : 'Off'}</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Notifications</div>
        <div class="card">
          ${!pushSupported && html`
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">Push notifications</div>
                <div class="settings-row-desc">Not supported in this browser</div>
              </div>
            </div>
          `}
          ${pushSupported && iosNotInstalled && html`
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">Push notifications</div>
                <div class="settings-row-desc">Add this app to your Home Screen to enable</div>
              </div>
            </div>
          `}
          ${pushSupported && !iosNotInstalled && html`
            ${prefs === null && html`
              <div class="settings-row"><div class="settings-row-desc">Loading…</div></div>
            `}
            ${prefs !== null && html`
              <div class="settings-row">
                <div class="settings-row-left">
                  <div class="settings-row-label">New album of the day</div>
                  <div class="settings-row-desc">Get notified when your next album drops</div>
                </div>
                <button
                  id="push-toggle"
                  type="button"
                  class=${`toggle-btn ${prefs.subscribed ? 'on' : ''}`}
                  onClick=${handleToggle}
                  disabled=${toggling}
                  aria-pressed=${prefs.subscribed}
                >${prefs.subscribed ? 'On' : 'Off'}</button>
              </div>
              ${prefs.subscribed && html`
                <div class="settings-row">
                  <div class="settings-row-left">
                    <div class="settings-row-label">Deliver at</div>
                    <div class="settings-row-desc">Approximate local delivery time</div>
                  </div>
                  <select id="notify-hour" value=${localHour} onChange=${handleHourChange}>
                    ${hours.map(h => html`<option value=${h.value} selected=${h.value === localHour}>${h.label}</option>`)}
                  </select>
                </div>
              `}
              ${pushError && html`
                <div class="settings-row">
                  <p class="error-text" style=${{ margin: 0 }}>${pushError}</p>
                </div>
              `}
            `}
          `}
        </div>
      </div>

    </div>
  `;
}

export function ThemeToggle({ theme, toggle }) {
  return html`
    <button
      type="button"
      class="theme-toggle"
      onClick=${toggle}
      aria-label=${theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title=${theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    ><span class="icon-symbol">${theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
  `;
}
