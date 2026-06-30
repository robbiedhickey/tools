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
- `1001-albums/pipeline/data/tracks-kv-bulk.json`: Wrangler KV bulk-upload artifact.

The JSON artifacts are intentionally under `1001-albums/pipeline/data/` so the enrichment
pipeline is self-contained. These files are tracked via Git LFS because they are generated,
moderately large, and produce noisy diffs.

The book/user harvests intentionally use the same compact conventions as the KV export: album
metadata appears once per album record, album-level service IDs live under `services`, and tracks
only contain track-level fields plus per-track service IDs/URLs.

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

Build the Apple Music track mapping from both harvests:

```sh
npm run tracks:apple-map
```

Build the KV bulk file:

```sh
npm run tracks:kv:build
```

By default this exports both book and user albums. If a Spotify album ID ever appears in both
catalogs, the book record wins.

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

## Resume Behavior

`fetch-1001-tracks.py` writes after each album and skips existing records with tracks unless
`--force` is passed. If a long run stops, rerun the same npm command and it will continue through
the canonical artifact.

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
