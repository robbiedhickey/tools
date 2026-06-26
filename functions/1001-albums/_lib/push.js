// Key shape intentionally uses `1001-albums:push:<username>` (not `:<projectName>:<feature>`)
// so the cron Worker can list({ prefix: '1001-albums:push:' }) over all subscribers without
// knowing individual project names.
//
// Record shape:
// { endpoint, keys:{p256dh,auth}, notifyAtUtc,
//   prefs:{ new_album:true },
//   state:{ new_album:{ currentAlbumUuid, lastAlbumDate } },
//   pending:[ { type, title, body, data, deliverAfter } ] }

export function pushKey(username) {
  return `1001-albums:push:${username}`;
}

export async function readPushRecord(env, username) {
  const raw = await env.TOOLS_KV.get(pushKey(username));
  return raw ? JSON.parse(raw) : null;
}

export async function writePushRecord(env, username, record) {
  await env.TOOLS_KV.put(pushKey(username), JSON.stringify(record));
}

export async function deletePushRecord(env, username) {
  await env.TOOLS_KV.delete(pushKey(username));
}
