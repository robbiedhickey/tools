import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

async function readRootFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('home page links to the setlist timer tool', async () => {
  const html = await readRootFile('index.html');

  assert.match(html, /href="setlist-timer\.html"/);
  assert.match(html, />Setlist Timer</);
});

test('setlist timer is a standalone static app with shareable state', async () => {
  const html = await readRootFile('setlist-timer.html');

  assert.match(html, /<title>Setlist Timer<\/title>/);
  assert.match(html, /id="song-list"/);
  assert.match(html, /id="total-time"/);
  assert.match(html, /URLSearchParams/);
  assert.match(html, /navigator\.clipboard/);
});
