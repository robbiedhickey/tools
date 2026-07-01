export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  appearance: {
    theme: 'system',
  },
  music: {
    preferredService: 'spotify',
    embeddablePlayers: true,
    recommendations: true,
  },
};

export function settingsKey(projectName) {
  return `1001-albums:${projectName}:settings`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeSettings(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === 'updatedAt') continue;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeSettings(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeSettings(value) {
  const settings = mergeSettings(DEFAULT_SETTINGS, value || {});
  settings.schemaVersion = 1;
  return settings;
}

export async function readSettings(env, projectName) {
  const raw = await env.TOOLS_KV.get(settingsKey(projectName));
  return {
    exists: !!raw,
    settings: normalizeSettings(raw ? JSON.parse(raw) : null),
  };
}

export async function writeSettings(env, projectName, settings) {
  const record = {
    ...normalizeSettings(settings),
    updatedAt: new Date().toISOString(),
  };
  await env.TOOLS_KV.put(settingsKey(projectName), JSON.stringify(record));
  return record;
}
