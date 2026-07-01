import { createContext } from 'preact';
import { useState, useEffect, useCallback, useContext } from 'preact/hooks';
import {
  DEFAULT_SETTINGS, MUSIC_SERVICE_PREFERENCES, SETTINGS_CACHE_KEY, THEME_KEY,
  MUSIC_SERVICE_PREFERENCE_KEY, EMBEDDABLE_PLAYERS_ENABLED_KEY, DIDDY_ENABLED_KEY,
  SETTINGS_API_BASE,
} from './constants.js';

export const SettingsContext = createContext(null);

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeSettings(base, patch) {
  const result = { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === 'updatedAt') return;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeSettings(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

export function normalizeSettings(value) {
  const settings = mergeSettings(DEFAULT_SETTINGS, value || {});
  if (!MUSIC_SERVICE_PREFERENCES.has(settings.music.preferredService)) settings.music.preferredService = 'spotify';
  if (!['system', 'light', 'dark'].includes(settings.appearance.theme)) settings.appearance.theme = 'system';
  settings.music.embeddablePlayers = settings.music.embeddablePlayers !== false;
  settings.music.recommendations = settings.music.recommendations !== false;
  settings.schemaVersion = 1;
  return settings;
}

export function settingsCacheKey(projectName) {
  return projectName ? `${SETTINGS_CACHE_KEY}:${projectName}` : `${SETTINGS_CACHE_KEY}:local`;
}

export function readLegacySettings() {
  const settings = {};
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === 'light' || theme === 'dark') settings.appearance = { theme };
  } catch (e) {}
  try {
    const preferredService = localStorage.getItem(MUSIC_SERVICE_PREFERENCE_KEY);
    if (MUSIC_SERVICE_PREFERENCES.has(preferredService)) settings.music = { ...(settings.music || {}), preferredService };
  } catch (e) {}
  try {
    const players = localStorage.getItem(EMBEDDABLE_PLAYERS_ENABLED_KEY);
    if (players != null) settings.music = { ...(settings.music || {}), embeddablePlayers: players !== 'false' };
  } catch (e) {}
  try {
    const recommendations = localStorage.getItem(DIDDY_ENABLED_KEY);
    if (recommendations != null) settings.music = { ...(settings.music || {}), recommendations: recommendations !== 'false' };
  } catch (e) {}
  return settings;
}

export function readLocalSettings(projectName = null) {
  try {
    const raw = localStorage.getItem(settingsCacheKey(projectName));
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch (e) {}
  return normalizeSettings(readLegacySettings());
}

export function writeLocalSettings(projectName, settings) {
  const normalized = normalizeSettings(settings);
  try { localStorage.setItem(settingsCacheKey(projectName), JSON.stringify(normalized)); } catch (e) {}
  try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(normalized)); } catch (e) {}
  return normalized;
}

export async function fetchSettings(projectName) {
  const res = await fetch(`${SETTINGS_API_BASE}/${encodeURIComponent(projectName)}`);
  if (!res.ok) throw new Error(`Settings failed (${res.status})`);
  const body = await res.json();
  return {
    exists: !!body.exists,
    settings: normalizeSettings(body.settings),
  };
}

export async function patchSettings(projectName, patch) {
  const res = await fetch(`${SETTINGS_API_BASE}/${encodeURIComponent(projectName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Settings failed (${res.status})`);
  const body = await res.json();
  return normalizeSettings(body.settings);
}

export function resolvedTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useSettings(projectName = null) {
  const [settings, setSettings] = useState(() => readLocalSettings(projectName));
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    const local = readLocalSettings(projectName);
    setSettings(local);
    if (!projectName) return;
    let cancelled = false;
    fetchSettings(projectName)
      .then((remote) => {
        if (cancelled) return;
        const next = remote.exists ? remote.settings : local;
        setSettings(next);
        writeLocalSettings(projectName, next);
        setSyncError('');
      })
      .catch((err) => { if (!cancelled) setSyncError(err.message || 'Settings sync failed'); });
    return () => { cancelled = true; };
  }, [projectName]);

  const update = useCallback((patch) => {
    setSettings((current) => {
      const next = writeLocalSettings(projectName, mergeSettings(current, patch));
      if (projectName) {
        patchSettings(projectName, patch)
          .then((remote) => {
            setSettings(remote);
            writeLocalSettings(projectName, remote);
            setSyncError('');
          })
          .catch((err) => setSyncError(err.message || 'Settings sync failed'));
      }
      return next;
    });
  }, [projectName]);

  const theme = {
    theme: resolvedTheme(settings.appearance.theme),
    preference: settings.appearance.theme,
    setTheme: (next) => update({ appearance: { theme: next } }),
    toggle: () => update({ appearance: { theme: resolvedTheme(settings.appearance.theme) === 'dark' ? 'light' : 'dark' } }),
  };
  const musicService = {
    preference: settings.music.preferredService,
    setPreference: (next) => {
      if (MUSIC_SERVICE_PREFERENCES.has(next)) update({ music: { preferredService: next } });
    },
  };
  const players = {
    enabled: settings.music.embeddablePlayers !== false,
    toggle: () => update({ music: { embeddablePlayers: settings.music.embeddablePlayers === false } }),
  };
  const diddy = {
    enabled: settings.music.recommendations !== false,
    toggle: () => update({ music: { recommendations: settings.music.recommendations === false } }),
  };

  return { settings, update, theme, musicService, players, diddy, syncError };
}

export function useApplyTheme(theme) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.theme === 'dark' ? '#171512' : '#f6f5f3');
  }, [theme.theme]);
}

export function useSettingsContext() {
  return useContext(SettingsContext);
}

export function useMusicService() {
  return useSettingsContext()?.musicService || { preference: 'spotify', setPreference: () => {} };
}

export function useEmbeddablePlayers() {
  return useSettingsContext()?.players || { enabled: true, toggle: () => {} };
}
