import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { fetchFavorites, putFavoriteTrack, deleteFavoriteTrack } from './api.js';

// ---------- favorite tracks (backed by functions/1001-albums/api/favorites/, see _lib/favorites.js) ----------
export function favoriteTrackId(track) {
  return track?.appleTrackId || track?.spotifyTrackId || null;
}

export function useFavoriteTracks(projectName) {
  const [favorites, setFavorites] = useState({});
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!projectName) return;
    let cancelled = false;
    fetchFavorites(projectName)
      .then((data) => { if (!cancelled) setFavorites(data); })
      .catch((err) => { if (!cancelled) setErrorMessage(err.message); });
    return () => { cancelled = true; };
  }, [projectName]);

  // Optimistic: flip local state immediately, fire the API call in the background, and roll back
  // (restoring the prior map) if it fails so the star never lies about what's actually saved.
  const toggle = useCallback((track) => {
    if (!projectName) return;
    const trackId = favoriteTrackId(track);
    if (!trackId) return;
    setFavorites((prev) => {
      const next = { ...prev };
      const wasFavorited = !!next[trackId];
      if (wasFavorited) {
        delete next[trackId];
        deleteFavoriteTrack(projectName, trackId).catch((err) => {
          setErrorMessage(err.message);
          setFavorites((current) => ({ ...current, [trackId]: prev[trackId] }));
        });
      } else {
        const entry = { ...track, favoritedAt: Date.now() };
        next[trackId] = entry;
        putFavoriteTrack(projectName, trackId, entry).catch((err) => {
          setErrorMessage(err.message);
          setFavorites((current) => {
            const reverted = { ...current };
            delete reverted[trackId];
            return reverted;
          });
        });
      }
      return next;
    });
  }, [projectName]);
  // Refreshes a favorite's stored metadata snapshot whenever its track data is on hand again
  // (e.g. revisiting the album). Always overwrites rather than gating on "already has a title" —
  // a favorite saved before a field was added (or from a stale cache) would otherwise get stuck
  // with an incomplete snapshot forever, since having *a* title doesn't mean it has every field.
  const sync = useCallback((track) => {
    if (!projectName) return;
    const trackId = favoriteTrackId(track);
    if (!trackId) return;
    setFavorites((prev) => {
      const existing = prev[trackId];
      if (!existing) return prev;
      const merged = { ...track, favoritedAt: existing.favoritedAt || Date.now() };
      const unchanged = Object.keys(merged).every((key) => existing[key] === merged[key]);
      if (unchanged) return prev;
      putFavoriteTrack(projectName, trackId, merged).catch((err) => setErrorMessage(err.message));
      return { ...prev, [trackId]: merged };
    });
  }, [projectName]);
  const list = useMemo(
    () => Object.values(favorites).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0)),
    [favorites]
  );
  return { isFavorite: (trackId) => !!favorites[trackId], toggle, sync, list, errorMessage, clearError: () => setErrorMessage('') };
}
