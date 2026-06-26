import { buildPushPayload } from '@block65/webcrypto-web-push';

const SITE_BASE = 'https://1001albumsgenerator.com';
const KV_PREFIX = '1001-albums:push:';
// ms delay between upstream API calls to avoid hammering the shared Cloudflare egress IP pool
const THROTTLE_MS = 500;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listAllSubscribers(env) {
  const results = [];
  let cursor;
  do {
    const page = await env.TOOLS_KV.list({ prefix: KV_PREFIX, cursor });
    results.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return results;
}

async function sendPush(env, record, item) {
  const subscription = {
    endpoint: record.endpoint,
    expirationTime: null,
    keys: record.keys,
  };
  const message = {
    data: { title: item.title, body: item.body, data: item.data ?? {} },
    options: { ttl: 60 * 60 * 24 },
  };
  const vapid = {
    subject: 'mailto:thadiggitystank@gmail.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const { headers, method, body } = await buildPushPayload(message, subscription, vapid);
  const res = await fetch(subscription.endpoint, { method, headers, body });
  return res.status;
}

// Detection pass: runs during 04–05 UTC window.
// For each subscriber with new_album pref and a new album today, enqueue a pending notification.
async function runDetection(env) {
  const keys = await listAllSubscribers(env);
  const today = todayUTC();

  for (const key of keys) {
    const username = key.name.slice(KV_PREFIX.length);
    const raw = await env.TOOLS_KV.get(key.name);
    if (!raw) continue;
    const record = JSON.parse(raw);

    if (!record.prefs?.new_album) continue;
    if (record.state?.new_album?.lastAlbumDate === today) continue;

    let albumData;
    try {
      const res = await fetch(`${SITE_BASE}/api/v1/projects/${encodeURIComponent(username)}`);
      if (res.status === 429) {
        console.log(`Rate limited fetching ${username}, aborting detection tick`);
        return;
      }
      if (!res.ok) continue;
      albumData = await res.json();
    } catch {
      continue;
    }

    const currentUuid = albumData?.currentAlbum?.uuid;
    if (!currentUuid) continue;
    if (currentUuid === record.state?.new_album?.currentAlbumUuid) continue;

    const album = albumData.currentAlbum;
    const artist = album.artist || '';
    const albumName = album.album || album.name || '';
    const notifyAtUtc = record.notifyAtUtc ?? 9;
    const [year, month, day] = today.split('-').map(Number);
    const deliverAfter = Date.UTC(year, month - 1, day, notifyAtUtc, 0, 0);

    record.state = record.state ?? {};
    record.state.new_album = { currentAlbumUuid: currentUuid, lastAlbumDate: today };
    record.pending = record.pending ?? [];
    record.pending.push({
      type: 'new_album',
      title: "Today's album is ready",
      body: `${artist} — ${albumName}`,
      data: { url: `/1001-albums/#/${encodeURIComponent(username)}/today` },
      deliverAfter,
    });

    await env.TOOLS_KV.put(key.name, JSON.stringify(record));
    await sleep(THROTTLE_MS);
  }
}

// Delivery pass: runs every hour.
// Sends any pending notifications whose deliverAfter is in the past.
async function runDelivery(env) {
  const keys = await listAllSubscribers(env);
  const now = Date.now();

  for (const key of keys) {
    const raw = await env.TOOLS_KV.get(key.name);
    if (!raw) continue;
    const record = JSON.parse(raw);

    if (!record.pending?.length) continue;

    const still = [];
    let changed = false;
    for (const item of record.pending) {
      if (item.deliverAfter > now) {
        still.push(item);
        continue;
      }
      const status = await sendPush(env, record, item);
      changed = true;
      if (status === 404 || status === 410) {
        // Dead endpoint — remove the whole subscription record
        await env.TOOLS_KV.delete(key.name);
        still.length = 0;
        break;
      }
      // Other failures: drop the item (will retry next hour via re-detection is acceptable)
    }

    if (changed && still.length !== record.pending.length) {
      record.pending = still;
      if (still.length > 0 || record.endpoint) {
        await env.TOOLS_KV.put(key.name, JSON.stringify(record));
      }
    }
  }
}

export default {
  async scheduled(event, env) {
    const cron = event.cron ?? '';
    const isDetectionWindow = /^[0-9,]+ 4-5 /.test(cron);
    const isHourly = cron === '0 * * * *';

    if (isDetectionWindow) await runDetection(env);
    if (isHourly) await runDelivery(env);
    // If neither matched (e.g. manual trigger), run both
    if (!isDetectionWindow && !isHourly) {
      await runDetection(env);
      await runDelivery(env);
    }
  },
};
