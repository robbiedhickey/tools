import { readPushRecord, writePushRecord, deletePushRecord } from '../../_lib/push.js';

// GET /1001-albums/api/push/:projectName
// Returns { subscribed: bool, notifyAtUtc: number|null, prefs: {...} } for the settings UI.
export async function onRequestGet({ params, env }) {
  const record = await readPushRecord(env, params.projectName);
  if (!record) return Response.json({ subscribed: false, notifyAtUtc: null, prefs: {} });
  return Response.json({
    subscribed: true,
    notifyAtUtc: record.notifyAtUtc ?? null,
    prefs: record.prefs ?? {},
  });
}

// POST /1001-albums/api/push/:projectName
// Body: { endpoint, keys:{p256dh,auth}, notifyAtUtc, prefs, currentAlbumUuid }
// Upserts the subscription and seeds state so the first run doesn't trigger a spurious push.
export async function onRequestPost({ params, env, request }) {
  const body = await request.json();
  const { endpoint, keys, notifyAtUtc, prefs, currentAlbumUuid } = body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return new Response('Missing subscription fields', { status: 400 });
  }

  const existing = await readPushRecord(env, params.projectName);
  const todayUTC = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  // Treat "today's album" as already delivered if it's past 04:00 UTC — the window when the
  // cron detection runs — so the user doesn't get a notification for an album they've already seen.
  const pastDetectionWindow = new Date().getUTCHours() >= 4;

  const record = {
    endpoint,
    keys,
    notifyAtUtc: notifyAtUtc ?? 9,
    prefs: prefs ?? { new_album: true },
    state: {
      new_album: {
        currentAlbumUuid: currentAlbumUuid ?? null,
        lastAlbumDate: pastDetectionWindow ? todayUTC : (existing?.state?.new_album?.lastAlbumDate ?? null),
      },
    },
    pending: existing?.pending ?? [],
  };

  await writePushRecord(env, params.projectName, record);
  return Response.json({ ok: true });
}

// DELETE /1001-albums/api/push/:projectName
// Removes the push subscription record entirely.
export async function onRequestDelete({ params, env }) {
  await deletePushRecord(env, params.projectName);
  return Response.json({ ok: true });
}
