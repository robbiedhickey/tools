# 1001 Albums Track Ingestion

This directory owns the enrichment pipeline for the 1001 Albums app. The app still treats
`1001albumsgenerator.com` as the catalog source of truth; KV is the enrichment layer for track
lists and service mappings.

## Layout

- `1001-albums/pipeline/scripts/`: fetch, map, and KV export scripts.
- `1001-albums/pipeline/data/book-tracks-data.json`: canonical book-album harvest from `/albums`.
- `1001-albums/pipeline/data/user-tracks-data.json`: user-submitted album harvest from `/user-albums`.
- `1001-albums/pipeline/data/apple-track-map.json`: Spotify track ID to Apple Music track ID mapping.
- `1001-albums/pipeline/data/tracks-kv-bulk.json`: Wrangler KV bulk-upload artifact.

The JSON artifacts are intentionally under `1001-albums/pipeline/data/` so the enrichment
pipeline is self-contained. These files are tracked via Git LFS because they are generated,
moderately large, and produce noisy diffs.

## Commands

Fetch the book catalog into the canonical book artifact:

```sh
npm run tracks:fetch
```

Fetch user-submitted albums:

```sh
npm run tracks:fetch:user
```

Build the Apple Music track mapping from both harvests:

```sh
npm run tracks:apple-map
```

Build the KV bulk file:

```sh
npm run tracks:kv:build
```

Validate locally:

```sh
npm run tracks:kv:put:local
```

Upload remotely:

```sh
npm run tracks:kv:put
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
