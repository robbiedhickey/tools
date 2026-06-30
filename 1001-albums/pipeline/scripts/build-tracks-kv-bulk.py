#!/usr/bin/env python3
"""
Convert generated 1001-albums track data into Wrangler KV bulk-upload JSON.

Usage:
  uv run 1001-albums/pipeline/scripts/build-tracks-kv-bulk.py

Then validate locally or upload remotely:
  npx wrangler kv bulk put 1001-albums/pipeline/data/tracks-kv-bulk.json --binding TOOLS_KV --local
  npx wrangler kv bulk put 1001-albums/pipeline/data/tracks-kv-bulk.json --binding TOOLS_KV --remote

KV convention:
  key:   1001-albums:album:{spotifyAlbumId}
  value: one self-contained album enrichment record with album metadata, service IDs,
         tracks, and available cross-service mappings.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_INPUTS = [
    Path("1001-albums/pipeline/data/book-tracks-data.json"),
    Path("1001-albums/pipeline/data/user-tracks-data.json"),
]
DEFAULT_APPLE_MAP = Path("1001-albums/pipeline/data/apple-track-map.json")
DEFAULT_OUTPUT = Path("1001-albums/pipeline/data/tracks-kv-bulk.json")
DEFAULT_PREFIX = "1001-albums:album"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def kv_pair(key: str, value: Any) -> dict[str, str]:
    return {"key": key, "value": compact_json(value)}


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_track_data(path: Path) -> dict[str, Any]:
    data = read_json(path)
    if not isinstance(data.get("albums"), dict):
        raise ValueError(f"{path} does not contain an albums object")
    return data


def load_apple_map(path: Path | None) -> dict[str, Any]:
    if not path or not path.exists():
        return {}
    data = read_json(path)
    albums = data.get("albums")
    if not isinstance(albums, dict):
        raise ValueError(f"{path} does not contain an albums object")
    return albums


def service_obj(**values: Any) -> dict[str, Any] | None:
    value = {key: item for key, item in values.items() if item is not None}
    return value or None


def spotify_track_id(track: dict[str, Any]) -> str | None:
    value = (track.get("services") or {}).get("spotify", {}).get("trackId")
    return str(value) if value else None


def album_summary(spotify_id: str, album: dict[str, Any], tracks: list[dict[str, Any]]) -> dict[str, Any]:
    total_runtime = album.get("totalRuntimeMs")
    if total_runtime is None:
        total_runtime = sum(track.get("durationMs") or 0 for track in tracks) or None

    return {
        "spotifyAlbumId": spotify_id,
        "name": album.get("name"),
        "artist": album.get("artist"),
        "releaseDate": album.get("releaseDate"),
        "genres": album.get("genres") or [],
        "styles": album.get("styles") or [],
        "catalogSource": album.get("catalogSource"),
        "catalogNumber": album.get("catalogNumber"),
        "images": album.get("images") or [],
        "trackCount": album.get("trackCount") if album.get("trackCount") is not None else len(tracks),
        "totalRuntimeMs": total_runtime,
    }


def album_services(spotify_id: str, record: dict[str, Any]) -> dict[str, Any]:
    services: dict[str, Any] = {"spotify": {"albumId": spotify_id}}
    apple_album_id = ((record.get("services") or {}).get("appleMusic") or {}).get("albumId")
    if apple_album_id:
        services["appleMusic"] = {"albumId": str(apple_album_id)}
    return services


def track_services(track: dict[str, Any], apple_mapping: dict[str, Any] | None) -> dict[str, Any]:
    services: dict[str, Any] = {}
    track_id = spotify_track_id(track)
    if track_id:
        services["spotify"] = {
            "trackId": track_id,
            "url": (track.get("services") or {}).get("spotify", {}).get("url"),
        }

    apple_track_id = None
    apple_url = None
    match_method = None
    if apple_mapping:
        apple_track_id = apple_mapping.get("appleTrackId")
        apple_url = apple_mapping.get("trackViewUrl")
        match_method = apple_mapping.get("matchMethod")
    apple_service = service_obj(trackId=str(apple_track_id) if apple_track_id else None, url=apple_url, matchMethod=match_method)
    if apple_service:
        services["appleMusic"] = apple_service
    return services


def compact_track(track: dict[str, Any], album: dict[str, Any], apple_mapping: dict[str, Any] | None) -> dict[str, Any]:
    value = {
        "discNumber": track.get("discNumber"),
        "trackNumber": track.get("trackNumber"),
        "title": track.get("title"),
        "durationMs": track.get("durationMs"),
        "explicit": track.get("explicit"),
        "streamable": track.get("streamable"),
        "services": track_services(track, apple_mapping),
    }
    album_artist = album.get("artist")
    track_artist = track.get("artist")
    if track_artist and track_artist != album_artist:
        value["artist"] = track_artist
    return {key: item for key, item in value.items() if item is not None and item != {}}


def build_album_record(
    spotify_id: str,
    record: dict[str, Any],
    apple_map_record: dict[str, Any] | None,
    generated_at: str | None,
    prepared_at: str,
) -> dict[str, Any]:
    source_album = record.get("album") or {}
    source_tracks = [track for track in record.get("tracks") or [] if isinstance(track, dict)]
    apple_tracks = (apple_map_record or {}).get("tracks") or {}
    tracks = [
        compact_track(track, source_album, apple_tracks.get(spotify_track_id(track)))
        for track in source_tracks
    ]
    tracks.sort(key=lambda track: (track.get("discNumber") or 1, track.get("trackNumber") or 0))

    value: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "preparedAt": prepared_at,
        "source": "1001albumsgenerator.com",
        "spotifyAlbumId": spotify_id,
        "album": album_summary(spotify_id, source_album, source_tracks),
        "services": album_services(spotify_id, record),
        "tracks": tracks,
    }

    if apple_map_record:
        value["mappings"] = {
            "appleMusic": {
                "mappedAt": apple_map_record.get("mappedAt"),
                "mappedCount": apple_map_record.get("mappedCount", 0),
                "trackCount": apple_map_record.get("trackCount", 0),
                "unmatchedSpotifyTrackIds": apple_map_record.get("unmatchedSpotifyTrackIds") or [],
            }
        }

    if record.get("error"):
        value["errors"] = [record["error"]]

    return value


def build_bulk(datasets: list[dict[str, Any]], apple_map: dict[str, Any], prefix: str) -> list[dict[str, str]]:
    prepared_at = utc_now()
    merged_albums: dict[str, tuple[dict[str, Any], str | None]] = {}

    for data in datasets:
        generated_at = data.get("generatedAt")
        for spotify_id, record in (data.get("albums") or {}).items():
            if not isinstance(record, dict):
                continue
            existing = merged_albums.get(spotify_id)
            if existing and (existing[0].get("album") or {}).get("catalogSource") == "book":
                continue
            merged_albums[spotify_id] = (record, generated_at)

    rows: list[dict[str, str]] = []
    for spotify_id, (record, generated_at) in sorted(merged_albums.items()):
        value = build_album_record(
            spotify_id=spotify_id,
            record=record,
            apple_map_record=apple_map.get(spotify_id),
            generated_at=generated_at,
            prepared_at=prepared_at,
        )
        rows.append(kv_pair(f"{prefix}:{spotify_id}", value))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", dest="inputs", help="Track-data JSON input. May be passed more than once.")
    parser.add_argument("--apple-map", type=Path, default=DEFAULT_APPLE_MAP)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    args = parser.parse_args()

    input_paths = args.inputs or DEFAULT_INPUTS
    datasets = [load_track_data(path) for path in input_paths]
    apple_map = load_apple_map(args.apple_map)
    rows = build_bulk(datasets, apple_map, args.prefix.rstrip(":"))
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
        f.write("\n")

    track_count = sum(len(json.loads(row["value"]).get("tracks") or []) for row in rows)
    print(f"Wrote {len(rows)} album KV rows / {track_count} tracks to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
