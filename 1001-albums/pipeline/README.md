# 1001 Albums Track Ingestion

This directory owns the enrichment pipeline for the 1001 Albums app. The app still treats
`1001albumsgenerator.com` as the catalog source of truth; KV is the enrichment layer for track
lists and service mappings.

## Layout

- `1001-albums/pipeline/scripts/`: fetch, map, and KV export scripts.
- `1001-albums/pipeline/schemas/kv-album.schema.json`: JSON Schema for each KV album value.
- `1001-albums/pipeline/data/book-tracks-data.json`: canonical book-album harvest from `/albums`.
- `1001-albums/pipeline/data/user-tracks-data.json`: user-submitted album harvest from `/user-albums`.
- `1001-albums/pipeline/data/apple-track-map.json`: Spotify track ID to Apple Music track ID mapping.
- `1001-albums/pipeline/data/apple-album-overrides.json`: Apple Music album ID overrides found
  by the repair pass.
- `1001-albums/pipeline/data/wikipedia-map.json`: Spotify album ID to Wikipedia URL mapping.
- `1001-albums/pipeline/data/tracks-kv-bulk.json`: Wrangler KV bulk-upload artifact.
- `1001-albums/catalog-corrections.json`: small app-served map for stale IDs in upstream stats.

The JSON artifacts are intentionally under `1001-albums/pipeline/data/` so the enrichment
pipeline is self-contained. These files are tracked via Git LFS because they are generated,
moderately large, and produce noisy diffs.

The book/user harvests intentionally use the same compact conventions as the KV export: album
metadata appears once per album record, album-level service IDs live under `services`, and tracks
only contain track-level fields plus per-track service IDs/URLs.

## Agent Operating Rules

When enhancing this pipeline, keep the data contracts separate:

- Treat `/albums` and `/user-albums` harvest files as the canonical album/track source.
- Treat upstream `/albums/stats` and `/user-albums/stats` as browse/search metadata only. Those
  endpoints can be stale and may point at old Spotify IDs.
- Use `1001-albums/catalog-corrections.json` only for stale stats API corrections that the app
  must apply at runtime.
- Use `1001-albums/pipeline/data/apple-album-overrides.json` for Apple Music album ID repairs.
  Do not add general Apple repairs to `catalog-corrections.json`.
- Use `1001-albums/pipeline/data/wikipedia-map.json` for Wikipedia enrichment.
- Keep generated enrichment artifacts under `1001-albums/pipeline/data/`; avoid scattering
  one-off maps elsewhere.

Before changing pipeline behavior, measure the current state. Useful quick checks:

```sh
npm run tracks:kv:validate

node - <<'NODE'
const fs = require('fs');
const bulk = JSON.parse(fs.readFileSync('1001-albums/pipeline/data/tracks-kv-bulk.json', 'utf8'));
let appleTracks = 0, spotifyTracks = 0, wikiAlbums = 0;
for (const row of bulk) {
  const record = JSON.parse(row.value);
  if (record.services?.wikipedia?.url) wikiAlbums++;
  for (const track of record.tracks || []) {
    if (track.services?.spotify?.trackId) spotifyTracks++;
    if (track.services?.appleMusic?.trackId) appleTracks++;
  }
}
console.log({ records: bulk.length, spotifyTracks, appleTracks, appleTrackGap: spotifyTracks - appleTracks, wikiAlbums });
NODE
```

After changing enrichment logic, rebuild downstream artifacts in dependency order:

```sh
npm run tracks:apple-map
npm run tracks:kv:build
npm run tracks:kv:validate
```

Only upload after validation passes:

```sh
npm run tracks:kv:put
```

Be careful in a dirty worktree. Other agents may be refactoring the site at the same time; pipeline
changes should normally touch only `1001-albums/pipeline/**`, `package.json`, and possibly
`1001-albums/catalog-corrections.json` when the task is specifically about stale stats IDs.

## Commands

Fetch the book catalog into the canonical book artifact:

```sh
npm run tracks:fetch
```

Fetch user-submitted albums:

```sh
npm run tracks:fetch:user
```

Sync upstream album images once per album:

```sh
npm run tracks:images
```

Build the local catalog correction map:

```sh
npm run tracks:catalog-corrections
```

Build the Wikipedia URL mapping. Upstream Album DTOs are preferred when supplied because those
URLs are curated by 1001albumsgenerator:

```sh
npm run tracks:wikipedia-map -- --project hodorswit
```

Remaining gaps can be filled from Wikipedia search when you explicitly opt in:

```sh
npm run tracks:wikipedia-map -- --project hodorswit --search-missing
```

The Wikipedia search path is resumable. It writes both matches and misses after each album, uses
`maxlag=5`, and backs off on `429` responses.

Build the Apple Music track mapping from both harvests:

```sh
npm run tracks:apple-map
```

If `1001-albums/pipeline/data/apple-album-overrides.json` contains overrides, this command
prefers those corrected Apple albums when resolving track IDs.

Find replacement Apple album IDs for unmapped albums and write a reviewable candidate report:

```sh
npm run tracks:apple-repair
```

That writes `1001-albums/pipeline/data/apple-album-repair-candidates.json`. To automatically add
high-confidence candidates to `1001-albums/pipeline/data/apple-album-overrides.json`:

```sh
npm run tracks:apple-repair -- --apply --min-ratio 0.8
```

After applying overrides, rerun `tracks:apple-map -- --force` so corrected album IDs are used for
track-level Apple Music IDs.

For partial Apple track mappings, include partials in the repair pass:

```sh
npm run tracks:apple-repair -- --apply --min-ratio 0.8 --include-partials
```

The Apple repair script writes progress after each album and resumes from the existing candidate
report. If a long run is interrupted, rerun the same command.

Build the KV bulk file:

```sh
npm run tracks:kv:build
```

By default this exports both book and user albums. If a Spotify album ID ever appears in both
catalogs, the book record wins. Album-level Apple Music IDs are also corrected from
`1001-albums/pipeline/data/apple-album-overrides.json` when overrides exist.

Validate the KV bulk file against the schema:

```sh
npm run tracks:kv:validate
```

Validate locally:

```sh
npm run tracks:kv:put:local
```

Upload remotely:

```sh
npm run tracks:kv:put
```

## Operational Reruns

For the frequent path where user-submitted albums changed, rerun only the user harvest and the
derived enrichment/export steps:

```sh
npm run tracks:refresh:user
```

Expanded, that runs:

```sh
npm run tracks:fetch:user
npm run tracks:images
npm run tracks:catalog-corrections
npm run tracks:wikipedia-map
npm run tracks:apple-map
npm run tracks:kv:build
npm run tracks:kv:validate
npm run tracks:kv:put
```

`tracks:fetch:user` is resumable and skips existing albums with tracks, so this mainly picks up
new user-submitted albums. `tracks:apple-map` also skips albums whose existing mapping already
covers the track count, so it mainly maps new or changed albums.

For a full refresh, including the book catalog:

```sh
npm run tracks:refresh
```

Expanded, that runs:

```sh
npm run tracks:fetch
npm run tracks:fetch:user
npm run tracks:images
npm run tracks:catalog-corrections
npm run tracks:wikipedia-map
npm run tracks:apple-map
npm run tracks:kv:build
npm run tracks:kv:validate
npm run tracks:kv:put
```

To force refetching an artifact instead of using skip/resume behavior, run the underlying script
with `--force`, for example:

```sh
uv run --with SpotAPI --with pymongo --with redis --with websockets 1001-albums/pipeline/scripts/fetch-1001-tracks.py --catalog user --output 1001-albums/pipeline/data/user-tracks-data.json --force
```

After upload, verify a known key directly from remote KV:

```sh
npx wrangler kv key get '1001-albums:album:01lVJ9NbOvQgjsoBLwl0h8' --binding TOOLS_KV --remote
```

If direct remote KV reads fail with a Wrangler/OAuth `401`, verify through the deployed API
instead:

```sh
curl -fsS 'https://tools.robbiehickey.com/1001-albums/api/albums/01lVJ9NbOvQgjsoBLwl0h8?verify=1'
```

The album endpoint currently sends a short public cache header, so use a query string during
spot checks after upload.

## Resume Behavior

`fetch-1001-tracks.py` writes after each album and skips existing records with tracks unless
`--force` is passed. If a long run stops, rerun the same npm command and it will continue through
the canonical artifact.

`repair-apple-album-overrides.py` writes the candidate report and override file incrementally.
It skips albums already present in `apple-album-repair-candidates.json`, so it can safely resume
after interruption.

## Apple Repair Lessons

The common Apple Music failure mode is stale or wrong album IDs scraped from upstream album pages,
not just weak track matching. When Apple lookup returns zero songs or a poor edition, repair the
album ID first and then rebuild track mappings.

The repair flow is:

```sh
npm run tracks:apple-repair -- --apply --min-ratio 0.8
npm run tracks:apple-repair -- --apply --min-ratio 0.8 --include-partials
npm run tracks:apple-map
npm run tracks:kv:build
npm run tracks:kv:validate
npm run tracks:kv:put
```

Use the candidate report to review remaining misses:

```text
1001-albums/pipeline/data/apple-album-repair-candidates.json
```

Remaining gaps usually fall into one of these buckets:

- Apple has no confident US catalog match.
- The available Apple edition has a different track list than Spotify.
- The Spotify album is a compilation, live release, deluxe edition, or multi-disc album where
  one-to-one matching is not reliable.
- A manual override is needed, but the repair script did not meet the confidence threshold.

Do not lower `--min-ratio` casually. A lower threshold can add plausible-looking but wrong album
IDs. Prefer reviewing the candidate report and adding targeted overrides.

## KV Convention

Each album is stored as one KV record:

```text
1001-albums:album:{spotifyAlbumId}
```

The app fetches a single album enrichment payload from:

```text
/1001-albums/api/albums/{spotifyAlbumId}
```

The value is self-contained and compact: album metadata appears once, album-level service IDs live
under `services`, and each track contains only track-level fields plus per-service IDs/URLs.
Album-level service enrichments currently include Spotify, Apple Music, and Wikipedia when known.
