#!/usr/bin/env python3
"""
Build a Spotify-track to Apple-track mapping from generated album track data.

This is intentionally a separate output so it can run while the SpotAPI fetchers are still
writing their JSON files.

Usage:
  uv run 1001-albums/pipeline/scripts/build-apple-track-map.py 1001-albums/pipeline/data/book-tracks-data.json 1001-albums/pipeline/data/user-tracks-data.json --output 1001-albums/pipeline/data/apple-track-map.json
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT = Path("1001-albums/pipeline/data/apple-track-map.json")
DEFAULT_APPLE_ALBUM_OVERRIDES = Path("1001-albums/pipeline/data/apple-album-overrides.json")
USER_AGENT = "tools.robbiehickey.com apple-track mapper"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json_retry(path: Path, retries: int = 5) -> dict[str, Any]:
    last_error: Exception | None = None
    for _ in range(retries):
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as err:
            last_error = err
            time.sleep(0.2)
    raise RuntimeError(f"Could not read stable JSON from {path}: {last_error}")


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def normalize_title(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"\([^)]*\)|\[[^]]*\]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def fetch_apple_album(apple_album_id: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {
            "id": apple_album_id,
            "entity": "song",
            "country": "US",
            "media": "music",
        }
    )
    req = urllib.request.Request(
        f"https://itunes.apple.com/lookup?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def parse_apple_tracks(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [
        row
        for row in data.get("results", [])
        if row.get("wrapperType") == "track" and row.get("kind") == "song"
    ]
    rows.sort(key=lambda row: (row.get("discNumber") or 1, row.get("trackNumber") or 0))
    return rows


def match_track(spotify_track: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    disc = spotify_track.get("discNumber") or 1
    number = spotify_track.get("trackNumber")
    title = normalize_title(spotify_track.get("title"))
    duration = spotify_track.get("durationMs")

    same_position = [
        row
        for row in candidates
        if (row.get("discNumber") or 1) == disc and row.get("trackNumber") == number
    ]
    if len(same_position) == 1:
        return same_position[0], "disc-track"

    if same_position:
        title_matches = [row for row in same_position if normalize_title(row.get("trackName")) == title]
        if len(title_matches) == 1:
            return title_matches[0], "disc-track-title"

    title_matches = [row for row in candidates if normalize_title(row.get("trackName")) == title]
    if duration is not None:
        close = [
            row
            for row in title_matches
            if row.get("trackTimeMillis") is not None and abs(row["trackTimeMillis"] - duration) <= 5000
        ]
        if len(close) == 1:
            return close[0], "title-duration"
    if len(title_matches) == 1:
        return title_matches[0], "title"

    return None, "none"


def spotify_track_id(track: dict[str, Any]) -> str | None:
    value = (track.get("services") or {}).get("spotify", {}).get("trackId")
    return str(value) if value else None


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "albums": {}}
    return read_json_retry(path)


def load_apple_album_overrides(path: Path | None) -> dict[str, str]:
    if not path or not path.exists():
        return {}
    data = read_json_retry(path)
    overrides: dict[str, str] = {}
    for spotify_id, override in (data.get("albums") or {}).items():
        if not isinstance(override, dict):
            continue
        apple_id = override.get("appleMusicId")
        if apple_id:
            overrides[spotify_id] = str(apple_id)
    return overrides


def iter_album_records(paths: list[Path]) -> list[tuple[str, dict[str, Any], str]]:
    records = []
    for path in paths:
        if not path.exists():
            continue
        data = read_json_retry(path)
        for spotify_id, record in (data.get("albums") or {}).items():
            if isinstance(record, dict):
                records.append((spotify_id, record, str(path)))
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apple-album-overrides", type=Path, default=DEFAULT_APPLE_ALBUM_OVERRIDES)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    output = load_existing(args.output)
    output["version"] = 1
    output.setdefault("albums", {})
    apple_album_overrides = load_apple_album_overrides(args.apple_album_overrides)

    records = iter_album_records(args.inputs)
    for index, (spotify_id, record, source_path) in enumerate(records, start=1):
        album = record.get("album") or {}
        source_apple_id = ((record.get("services") or {}).get("appleMusic") or {}).get("albumId")
        apple_id = apple_album_overrides.get(spotify_id) or source_apple_id
        tracks = [track for track in record.get("tracks") or [] if spotify_track_id(track)]
        existing = output["albums"].get(spotify_id)
        if not args.force and existing and existing.get("mappedCount", 0) >= len(tracks):
            print(f"[{index}/{len(records)}] skip {spotify_id}")
            continue
        if not apple_id or not tracks:
            continue

        print(f"[{index}/{len(records)}] map {album.get('artist')} - {album.get('name')} ({spotify_id})")
        try:
            apple_data = fetch_apple_album(apple_id)
            apple_tracks = parse_apple_tracks(apple_data)
            mappings = {}
            unmatched = []
            for track in tracks:
                match, method = match_track(track, apple_tracks)
                track_id = spotify_track_id(track)
                if match and match.get("trackId") is not None:
                    mappings[track_id] = {
                        "appleTrackId": str(match["trackId"]),
                        "trackViewUrl": match.get("trackViewUrl"),
                        "matchMethod": method,
                    }
                else:
                    unmatched.append(track_id)
            output["albums"][spotify_id] = {
                "spotifyAlbumId": spotify_id,
                "appleAlbumId": apple_id,
                "sourceAppleAlbumId": source_apple_id,
                "sourcePath": source_path,
                "mappedAt": utc_now(),
                "trackCount": len(tracks),
                "mappedCount": len(mappings),
                "unmatchedSpotifyTrackIds": unmatched,
                "tracks": mappings,
            }
        except Exception as err:
            output["albums"][spotify_id] = {
                "spotifyAlbumId": spotify_id,
                "appleAlbumId": apple_id,
                "sourcePath": source_path,
                "mappedAt": utc_now(),
                "error": {"type": type(err).__name__, "message": str(err)},
                "tracks": {},
            }
        output["generatedAt"] = utc_now()
        write_json(args.output, output)
        if args.delay and index < len(records):
            time.sleep(args.delay)

    print(f"Wrote mappings for {len(output['albums'])} albums to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
