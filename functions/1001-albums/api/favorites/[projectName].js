import { readFavorites } from '../../_lib/favorites.js';

// GET /1001-albums/api/favorites/:projectName
// Returns the full favorites map ({ [appleTrackId]: entry }) for a project, or {} if none exist.
export async function onRequestGet({ params, env }) {
  const favorites = await readFavorites(env, params.projectName);
  return Response.json(favorites);
}
