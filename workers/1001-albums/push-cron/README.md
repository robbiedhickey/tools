# 1001-albums push-cron Worker

Cloudflare Worker that detects new albums and delivers push notifications to subscribers.

## Deploy

Unlike the main site (Cloudflare Pages, auto-deploys on push), this Worker must be deployed manually:

```bash
cd workers/1001-albums/push-cron
npm ci
npx wrangler deploy
```

Deploy whenever you change files under this directory.

## Secrets

Secrets are set once via wrangler and persist in Cloudflare — you don't need to re-set them on each deploy.

| Secret | Description |
|--------|-------------|
| `VAPID_PRIVATE_KEY` | EC private key scalar (base64url). Paired with the public key embedded in `1001-albums/index.html`. |
| `VAPID_PUBLIC_KEY` | Same public key as in `index.html`, made available to the worker for VAPID auth headers. |

To rotate the keypair:
1. Generate new keys: `node -e "const {subtle}=globalThis.crypto;(async()=>{const p=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);const pub=await subtle.exportKey('raw',p.publicKey);const jwk=await subtle.exportKey('jwk',p.privateKey);const b=(buf)=>Buffer.from(buf).toString('base64url');console.log('PUBLIC:',b(pub));console.log('PRIVATE:',b(jwk.d));})()"`
2. Update `VAPID_PUBLIC_KEY` const in `1001-albums/index.html`
3. `echo <new-private> | npx wrangler secret put VAPID_PRIVATE_KEY`
4. `echo <new-public> | npx wrangler secret put VAPID_PUBLIC_KEY`
5. Deploy the worker

Note: rotating keys invalidates all existing push subscriptions — users will need to re-enable notifications.

## Cron schedule

| Cron | Purpose |
|------|---------|
| `0,15,30,45 4-5 * * *` | Detection — checks for new album during the ~04:00–05:00 UTC window when the upstream site advances |
| `0 * * * *` | Delivery — sends queued notifications at users' chosen local hour |

## KV key shape

Subscriptions are stored under `1001-albums:push:<username>` in `TOOLS_KV`. This prefix intentionally differs from the per-project `1001-albums:<projectName>:<feature>` shape used by other features so the worker can `list({ prefix: '1001-albums:push:' })` without knowing individual project names.
