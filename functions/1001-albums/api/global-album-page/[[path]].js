import { proxySitePage } from '../../_lib/upstream.js';

// Proxies the scraped 1001albumsgenerator.com album page (reviews/genres/context) that
// fetchGlobalAlbumPage (1001-albums/lib/api.js) used to fetch directly — a request to
// /1001-albums/api/global-album-page/albums/foo/bar maps to upstream /albums/foo/bar. HTML text
// passes straight through; the client still does its own parsing (parseGlobalReviews /
// parseGlobalAlbumContext) so that logic stays in one place.
export async function onRequestGet({ params, request, env, waitUntil }) {
  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = '/' + segments.map(encodeURIComponent).join('/');
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  try {
    const { data, stale } = await proxySitePage(env, waitUntil, path, { force });
    return new Response(data, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Cache-Status': stale ? 'stale' : 'fresh' },
    });
  } catch (err) {
    return Response.json(
      { message: err.message },
      { status: err.status || 502, headers: err.retryAfter ? { 'retry-after': err.retryAfter } : undefined }
    );
  }
}
