#!/usr/bin/env python3
"""
Sync album image arrays from upstream 1001 Albums stats endpoints.

Usage:
  uv run 1001-albums/pipeline/scripts/sync-upstream-images.py
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


BOOK_INPUT = Path("1001-albums/pipeline/data/book-tracks-data.json")
USER_INPUT = Path("1001-albums/pipeline/data/user-tracks-data.json")
BOOK_STATS_URL = "https://1001albumsgenerator.com/api/v1/albums/stats"
USER_STATS_URL = "https://1001albumsgenerator.com/api/v1/user-albums/stats"
USER_AGENT = "tools.robbiehickey.com upstream image sync"


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def fetch_stats(url: str) -> tuple[dict[str, list[dict[str, Any]]], dict[tuple[str, str], list[dict[str, Any]]]]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.loads(res.read().decode("utf-8"))
    by_id = {}
    by_name = {}
    for album in payload.get("albums") or []:
        images = album.get("images") or []
        if album.get("spotifyId"):
            by_id[album["spotifyId"]] = images
        if album.get("name") and album.get("artist"):
            by_name[(album["name"].lower(), album["artist"].lower())] = images
    return by_id, by_name


def fetch_oembed_image(spotify_album_id: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"url": f"https://open.spotify.com/album/{spotify_album_id}"})
    req = urllib.request.Request(
        f"https://open.spotify.com/oembed?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.loads(res.read().decode("utf-8"))
    if not payload.get("thumbnail_url"):
        return []
    return [
        {
            "height": payload.get("thumbnail_height"),
            "url": payload["thumbnail_url"],
            "width": payload.get("thumbnail_width"),
        }
    ]


def sync_images(
    path: Path,
    images_by_spotify_id: dict[str, list[dict[str, Any]]],
    images_by_name: dict[tuple[str, str], list[dict[str, Any]]],
    *,
    oembed_missing: bool,
) -> tuple[int, int]:
    data = read_json(path)
    changed = 0
    missing = 0
    for spotify_id, record in (data.get("albums") or {}).items():
        if not isinstance(record, dict):
            continue
        album = record.setdefault("album", {})
        album.pop("artworkUrl", None)
        images = images_by_spotify_id.get(spotify_id)
        if not images and album.get("name") and album.get("artist"):
            images = images_by_name.get((album["name"].lower(), album["artist"].lower()))
        if not images and oembed_missing:
            try:
                images = fetch_oembed_image(spotify_id)
            except Exception:
                images = []
        if images:
            if album.get("images") != images:
                album["images"] = images
                changed += 1
        else:
            album.pop("images", None)
            missing += 1
    write_json(path, data)
    return changed, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book-input", type=Path, default=BOOK_INPUT)
    parser.add_argument("--user-input", type=Path, default=USER_INPUT)
    parser.add_argument("--no-oembed-missing", action="store_true", help="Do not use Spotify oEmbed for stats misses.")
    args = parser.parse_args()

    book_by_id, book_by_name = fetch_stats(BOOK_STATS_URL)
    user_by_id, user_by_name = fetch_stats(USER_STATS_URL)
    book_changed, book_missing = sync_images(
        args.book_input,
        book_by_id,
        book_by_name,
        oembed_missing=not args.no_oembed_missing,
    )
    user_changed, user_missing = sync_images(
        args.user_input,
        user_by_id,
        user_by_name,
        oembed_missing=not args.no_oembed_missing,
    )
    print(f"Book images updated: {book_changed}, missing: {book_missing}")
    print(f"User images updated: {user_changed}, missing: {user_missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
