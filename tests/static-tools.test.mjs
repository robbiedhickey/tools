import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

async function readRootFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('home page links to the blue-green deployability tool', async () => {
  const html = await readRootFile('index.html');

  assert.match(html, /href="deployability-index\.html"/);
  assert.match(html, />Deployability Index</);
});

test('deployability index is a standalone static app about release readiness', async () => {
  const html = await readRootFile('deployability-index.html');

  assert.match(html, /<title>Deployability Index<\/title>/);
  assert.match(html, /id="deploy-score"/);
  assert.match(html, /id="blue-green-toggle"/);
  assert.match(html, /id="hundred-deploys"/);
  assert.match(html, /localStorage/);
  assert.match(html, /blue-green/i);
  assert.match(html, /Costco/i);
});
