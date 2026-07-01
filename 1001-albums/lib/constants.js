// ---------- constants ----------
export const API_BASE = 'https://1001albumsgenerator.com/api/v1';
export const SITE_BASE = 'https://1001albumsgenerator.com';
// Ratings/reviews on the real site happen at most a few times a day per person, so a long TTL
// doesn't mean stale data in practice — it just means fewer silent background refetches. Manual
// "Refresh" links (hub, group roster, catalog) always bypass this for an on-demand update.
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ROUTE_PREFIX = '1001-albums';
export const APP_BASE = `/${ROUTE_PREFIX}/`;
export const TRACK_ALBUM_API_BASE = `${APP_BASE}api/albums`;
export const SETTINGS_API_BASE = `${APP_BASE}api/settings`;
export const LANKY_GIF_URL = 'https://media.tenor.com/lEKATqfPUrgAAAAi/lanky-kong-funny.gif';
export const LANKY_LOADING_GIF_URL = 'https://media.tenor.com/dk8ZbQriTFoAAAAi/video-games-me-at-a-party.gif';
// VAPID public key — generate with: npx web-push generate-vapid-keys
// Set the private key via: wrangler secret put VAPID_PRIVATE_KEY (in workers/1001-albums/push-cron)
export const VAPID_PUBLIC_KEY = 'BHA_LbBJkMFgCeekjsVV9WtTOKWyxLFitup7ePl-JKEmKRV4ZE6MO2hmqA1XP0Oq_GVlMt8_NaMKrVX-9hSup7k';

export const ALBUM_CATALOG_CACHE_VERSION = 'v5';
export const CURRENT_PROJECT_KEY = 'current-project-name';
export const ALBUM_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export const MUSIC_SERVICE_PREFERENCE_KEY = '1001-albums:setting:music-service';
export const MUSIC_SERVICE_PREFERENCES = new Set(['apple', 'spotify']);
export const EMBEDDABLE_PLAYERS_ENABLED_KEY = '1001-albums:setting:embeddable-players';
export const SETTINGS_CACHE_KEY = '1001-albums:settings';
export const THEME_KEY = 'theme';
export const DIDDY_ENABLED_KEY = '1001-albums:setting:diddy';
export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  appearance: { theme: 'system' },
  music: {
    preferredService: 'spotify',
    embeddablePlayers: true,
    recommendations: true,
  },
};

export const VALID_TABS = new Set(['today', 'backlog', 'group', 'activity', 'me', 'settings', 'discover']);
// Sub-tabs within the album info panel (AlbumInfoTabs) — linkable as a trailing path segment
// on album/backlog-album routes, e.g. .../backlog/{id}/group, so a specific tab is shareable.
export const VALID_SUBTABS = new Set(['summary', 'tracks', 'reviews', 'group']);
export const DISCOVER_ALBUM_TABS = new Set(['summary', 'tracks', 'reviews']);
export const DISCOVER_PATH_TO_MODE = { keyword: 'keyword', genres: 'genre-style' };
export const DISCOVER_MODE_TO_PATH = { browse: '', keyword: 'keyword', 'genre-style': 'genres' };
export const LAST_DISCOVER_PATH_KEY = 'last-discover-path';
export const DISCOVER_SOURCES = new Set(['global', 'user']);

export const TAB_ORDER = { today: 0, backlog: 1, group: 2, me: 3, discover: 4, activity: 5, settings: 6 };
export const NAV_TAB_PARENT = { member: 'group', pair: 'group' };

export const PRIMARY_STREAMING_SERVICES = ['Spotify', 'Apple Music'];
export const STREAMING_ICONS = {
  'Spotify':       (size = 36) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Spotify"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  'Apple Music':   (size = 36) => `<svg width="${size}" height="${size}" viewBox="0 0 73 73" xmlns="http://www.w3.org/2000/svg" aria-label="Apple Music"><path fill-rule="evenodd" clip-rule="evenodd" d="M72,19.94c0-0.72-0.01-1.45-0.03-2.17c-0.04-1.58-0.14-3.17-0.42-4.73c-0.28-1.58-0.75-3.06-1.48-4.5c-0.72-1.41-1.66-2.71-2.78-3.83c-1.12-1.12-2.42-2.06-3.83-2.78c-1.44-0.73-2.91-1.2-4.49-1.48c-1.56-0.28-3.15-0.37-4.73-0.42C53.51,0.02,52.78,0.01,52.06,0c-0.86,0-1.72,0-2.58,0H22.52c-0.86,0-1.72,0-2.58,0c-0.72,0-1.45,0.01-2.17,0.03c-1.58,0.04-3.17,0.14-4.73,0.42C11.46,0.74,9.98,1.2,8.55,1.94C7.13,2.66,5.84,3.6,4.72,4.72S2.65,7.13,1.93,8.55c-0.73,1.44-1.2,2.91-1.48,4.5c-0.28,1.56-0.37,3.15-0.42,4.73C0.02,18.5,0.01,19.22,0,19.94c0,0.86,0,1.72,0,2.58v26.95c0,0.86,0,1.72,0,2.58c0,0.72,0.01,1.45,0.03,2.17c0.04,1.58,0.14,3.17,0.42,4.73c0.28,1.58,0.75,3.06,1.48,4.5c0.72,1.41,1.66,2.71,2.78,3.83s2.42,2.06,3.83,2.78c1.44,0.73,2.91,1.2,4.49,1.48c1.56,0.28,3.15,0.37,4.73,0.42c0.72,0.02,1.45,0.03,2.17,0.03c0.86,0.01,1.72,0,2.58,0h26.95c0.86,0,1.72,0,2.58,0c0.72,0,1.45-0.01,2.17-0.03c1.58-0.04,3.17-0.14,4.73-0.42c1.58-0.28,3.06-0.75,4.49-1.48c1.41-0.72,2.71-1.66,3.83-2.78c1.12-1.12,2.06-2.41,2.78-3.83c0.73-1.44,1.2-2.91,1.48-4.5c0.28-1.56,0.37-3.15,0.42-4.73c0.02-0.72,0.03-1.45,0.03-2.17c0.01-0.86,0-1.72,0-2.58V22.52C72,21.66,72,20.8,72,19.94z M52.71,46.85c0,0.91-0.01,1.74-0.2,2.65c-0.19,0.89-0.53,1.72-1.05,2.47c-0.52,0.75-1.19,1.36-1.97,1.82c-0.79,0.47-1.62,0.73-2.5,0.91c-1.66,0.33-2.79,0.41-3.86,0.2c-1.03-0.21-1.9-0.68-2.6-1.32c-1.03-0.95-1.68-2.23-1.82-3.56c-0.16-1.57,0.36-3.24,1.53-4.48c0.59-0.62,1.34-1.11,2.34-1.5c1.04-0.4,2.19-0.65,3.96-1c0.47-0.09,0.93-0.19,1.4-0.28c0.61-0.12,1.14-0.28,1.56-0.8c0.43-0.52,0.43-1.16,0.43-1.78V24.32c0-1.21-0.54-1.54-1.7-1.32c-0.83,0.16-18.62,3.75-18.62,3.75c-1,0.24-1.36,0.57-1.36,1.82v23.23c0,0.91-0.05,1.74-0.24,2.65c-0.19,0.89-0.53,1.72-1.05,2.47c-0.52,0.75-1.19,1.36-1.97,1.82c-0.79,0.47-1.62,0.74-2.5,0.92c-1.66,0.33-2.79,0.41-3.86,0.2c-1.03-0.21-1.9-0.69-2.6-1.33c-1.03-0.95-1.63-2.23-1.78-3.56c-0.16-1.57,0.31-3.24,1.49-4.48c0.59-0.62,1.34-1.11,2.34-1.5c1.04-0.4,2.19-0.65,3.96-1c0.47-0.09,0.93-0.19,1.4-0.28c0.61-0.12,1.14-0.28,1.56-0.8c0.42-0.52,0.47-1.13,0.47-1.75c0-4.92,0-26.78,0-26.78c0-0.36,0.03-0.6,0.05-0.72c0.09-0.56,0.31-1.05,0.72-1.39c0.34-0.28,0.78-0.48,1.33-0.6l0.01,0L49,11.33c0.19-0.04,1.73-0.31,1.91-0.33c1.16-0.1,1.81,0.66,1.81,1.89L52.71,46.85L52.71,46.85z"/></svg>`,
  'YouTube Music': (size = 36) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="YouTube Music"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
};

export const DIDDY_GIF_URL = '/1001-albums/diddy.gif';
export const GROUP_ALBUMS_VISIBLE_DEFAULT = 10;
export const FAVORITE_TRACKS_VISIBLE_DEFAULT = 50;
