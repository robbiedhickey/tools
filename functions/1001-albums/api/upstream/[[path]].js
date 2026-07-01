import { proxyApi } from '../../_lib/upstream.js';

// Generic passthrough for any GET under 1001albumsgenerator.com/api/v1 — a request to
// /1001-albums/api/upstream/projects/foo maps to upstream /projects/foo. Adding a new upstream
// endpoint needs no new route here, just a client call through apiGet() in lib/api.js; caching,
// SWR, and revalidation are all handled by proxyApi for every path alike.
export async function onRequestGet({ params, request, env, waitUntil }) {
  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = '/' + segments.map(encodeURIComponent).join('/');
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  try {
    const { data, stale } = await proxyApi(env, waitUntil, path, { force });
    return Response.json(data, { headers: { 'X-Cache-Status': stale ? 'stale' : 'fresh' } });
  } catch (err) {
    return Response.json(
      { message: err.message },
      { status: err.status || 502, headers: err.retryAfter ? { 'retry-after': err.retryAfter } : undefined }
    );
  }
}
