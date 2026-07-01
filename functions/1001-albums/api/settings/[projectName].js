import { mergeSettings, readSettings, writeSettings } from '../../_lib/settings.js';

export async function onRequestGet({ params, env }) {
  const { exists, settings } = await readSettings(env, params.projectName);
  return Response.json({ exists, settings });
}

export async function onRequestPatch({ params, env, request }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response('Expected a JSON object', { status: 400 });
  }

  const { settings: current } = await readSettings(env, params.projectName);
  const settings = await writeSettings(env, params.projectName, mergeSettings(current, body));
  return Response.json({ ok: true, settings });
}
