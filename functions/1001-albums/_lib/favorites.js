// Shared by the favorites routes below. Files under an underscore-prefixed folder are excluded
// from Pages Functions routing, so this is safe to import without becoming its own endpoint.
// Key shape is <project-slug>:<projectName>:<feature>, so a future feature (e.g. notes) can list
// everything for one user via a `1001-albums:<projectName>:` prefix scan.
export function favoritesKey(projectName) {
  return `1001-albums:${projectName}:favorites`;
}

export async function readFavorites(env, projectName) {
  const raw = await env.TOOLS_KV.get(favoritesKey(projectName));
  return raw ? JSON.parse(raw) : {};
}

export async function writeFavorites(env, projectName, favorites) {
  await env.TOOLS_KV.put(favoritesKey(projectName), JSON.stringify(favorites));
}
