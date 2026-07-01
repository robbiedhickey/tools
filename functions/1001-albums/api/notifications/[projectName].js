import { passthroughUpstream } from '../../_lib/upstream.js';

const SITE_BASE = 'https://1001albumsgenerator.com';

// Notifications are per-user live state — no cross-user reuse to gain from a shared cache — so
// this is a plain passthrough, not a proxyApi-style cache. It exists only so the browser talks
// same-origin and gets a readable Response on a ban/rate-limit instead of the opaque CORS
// failure useNotifications (1001-albums/lib/hub.js) used to hit against the origin directly.
export async function onRequestGet({ params, request }) {
  const read = new URL(request.url).searchParams.get('read') ?? 'false';
  const path = `/api/notifications/${encodeURIComponent(params.projectName)}?read=${encodeURIComponent(read)}`;
  try {
    const { data } = await passthroughUpstream(SITE_BASE, path);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { message: err.message },
      { status: err.status || 502, headers: err.retryAfter ? { 'retry-after': err.retryAfter } : undefined }
    );
  }
}
