import { readFavorites, writeFavorites } from '../../../../_lib/favorites.js';

// POST /1001-albums/api/favorites/:projectName/:trackId — body is the track entry, upserted by id.
export async function onRequestPost({ params, env, request }) {
  const entry = await request.json();
  const favorites = await readFavorites(env, params.projectName);
  favorites[params.trackId] = entry;
  await writeFavorites(env, params.projectName, favorites);
  return Response.json({ success: true });
}

// DELETE /1001-albums/api/favorites/:projectName/:trackId
export async function onRequestDelete({ params, env }) {
  const favorites = await readFavorites(env, params.projectName);
  delete favorites[params.trackId];
  await writeFavorites(env, params.projectName, favorites);
  return Response.json({ success: true });
}
