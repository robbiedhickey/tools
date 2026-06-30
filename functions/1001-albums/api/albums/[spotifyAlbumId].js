const albumKey = (spotifyAlbumId) => `1001-albums:album:${spotifyAlbumId}`;

// GET /1001-albums/api/albums/:spotifyAlbumId
// Returns the KV enrichment record for a single album.
export async function onRequestGet({ params, env }) {
  const spotifyAlbumId = params.spotifyAlbumId;
  const record = await env.TOOLS_KV.get(albumKey(spotifyAlbumId), 'json');
  if (!record) {
    return Response.json({ error: 'Album enrichment not found' }, { status: 404 });
  }
  return Response.json(record, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    },
  });
}
