import { APP_BASE, VAPID_PUBLIC_KEY } from './constants.js';

// ---------- push client helpers ----------
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function loadPushPrefs(projectName) {
  const res = await fetch(`${APP_BASE}api/push/${encodeURIComponent(projectName)}`);
  if (!res.ok) return { subscribed: false, notifyAtUtc: null, prefs: {} };
  return res.json();
}

export async function subscribePush(projectName, notifyAtUtc, currentAlbumUuid) {
  const reg = await navigator.serviceWorker.ready;
  await Notification.requestPermission();
  if (Notification.permission !== 'granted') throw new Error('Permission denied');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const j = sub.toJSON();
  await fetch(`${APP_BASE}api/push/${encodeURIComponent(projectName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: j.endpoint,
      keys: j.keys,
      notifyAtUtc,
      prefs: { new_album: true },
      currentAlbumUuid,
    }),
  });
}

export async function unsubscribePush(projectName) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await fetch(`${APP_BASE}api/push/${encodeURIComponent(projectName)}`, { method: 'DELETE' });
}

export function localHourToUtcHour(localHour) {
  const d = new Date();
  d.setHours(localHour, 0, 0, 0);
  return d.getUTCHours();
}
