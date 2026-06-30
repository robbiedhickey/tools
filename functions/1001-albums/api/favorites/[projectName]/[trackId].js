import { readFavorites, writeFavorites } from '../../../_lib/favorites.js';

function favoritesWriteError(error) {
  const message = error?.message || '';
  if (message.includes('KV put() limit exceeded')) {
    return Response.json(
      {
        error: 'favorites-write-limit',
        message: 'Favorites storage write limit has been reached for today. Try again later.',
      },
      { status: 503 }
    );
  }
  console.error('favorites write failed', error);
  return Response.json(
    {
      error: 'favorites-write-failed',
      message: 'Favorites storage is temporarily unavailable.',
    },
    { status: 500 }
  );
}

// POST /1001-albums/api/favorites/:projectName/:trackId — body is the track entry, upserted by id.
export async function onRequestPost({ params, env, request }) {
  const entry = await request.json();
  const favorites = await readFavorites(env, params.projectName);
  favorites[params.trackId] = entry;
  try {
    await writeFavorites(env, params.projectName, favorites);
  } catch (error) {
    return favoritesWriteError(error);
  }
  return Response.json({ success: true });
}

// DELETE /1001-albums/api/favorites/:projectName/:trackId
export async function onRequestDelete({ params, env }) {
  const favorites = await readFavorites(env, params.projectName);
  delete favorites[params.trackId];
  try {
    await writeFavorites(env, params.projectName, favorites);
  } catch (error) {
    return favoritesWriteError(error);
  }
  return Response.json({ success: true });
}
