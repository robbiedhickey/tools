#!/usr/bin/env python3
"""
Build a small client-side correction map for stale Spotify IDs in upstream stats APIs.

The app uses upstream stats for search/browse data, but a few stats rows point at Spotify IDs
that no longer match the canonical /albums or /user-albums pages. This script compares stats rows
to our canonical harvested pipeline data by album + artist and records only the mismatches.

Usage:
  uv run 1001-albums/pipeline/scripts/build-catalog-corrections.py
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BOOK_DATA = Path("1001-albums/pipeline/data/book-tracks-data.json")
USER_DATA = Path("1001-albums/pipeline/data/user-tracks-data.json")
OUTPUT = Path("1001-albums/catalog-corrections.json")
GLOBAL_STATS_URL = "https://1001albumsgenerator.com/api/v1/albums/stats"
USER_STATS_URL = "https://1001albumsgenerator.com/api/v1/user-albums/stats"
USER_AGENT = "tools.robbiehickey.com catalog corrections"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def key(name: str | None, artist: str | None) -> str:
    return f"{(name or '').strip().lower()}::{(artist or '').strip().lower()}"


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def canonical_by_name(path: Path) -> dict[str, dict[str, Any]]:
    data = read_json(path)
    rows = {}
    for spotify_id, record in (data.get("albums") or {}).items():
        album = record.get("album") or {}
        rows[key(album.get("name"), album.get("artist"))] = {
            "spotifyId": spotify_id,
            "name": album.get("name"),
            "artist": album.get("artist"),
        }
    return rows


def build_corrections(stats: dict[str, Any], canonical: dict[str, dict[str, Any]], path_prefix: str) -> dict[str, Any]:
    corrections = {}
    for album in stats.get("albums") or []:
        current_id = album.get("spotifyId")
        canonical_row = canonical.get(key(album.get("name"), album.get("artist")))
        if not current_id or not canonical_row or canonical_row["spotifyId"] == current_id:
            continue
        slug = album.get("slug")
        fixed_id = canonical_row["spotifyId"]
        corrections[current_id] = {
            "spotifyId": fixed_id,
            "globalReviewsUrl": f"https://1001albumsgenerator.com/{path_prefix}/{fixed_id}/{slug}" if slug else None,
        }
    return corrections


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book-data", type=Path, default=BOOK_DATA)
    parser.add_argument("--user-data", type=Path, default=USER_DATA)
    parser.add_argument("--global-stats", type=Path)
    parser.add_argument("--user-stats", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    global_stats = read_json(args.global_stats) if args.global_stats else fetch_json(GLOBAL_STATS_URL)
    user_stats = read_json(args.user_stats) if args.user_stats else fetch_json(USER_STATS_URL)
    data = {
        "version": 1,
        "generatedAt": utc_now(),
        "global": build_corrections(global_stats, canonical_by_name(args.book_data), "albums"),
        "user": build_corrections(user_stats, canonical_by_name(args.user_data), "user-albums"),
    }
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Wrote {args.output} "
        f"({len(data['global'])} global corrections, {len(data['user'])} user corrections)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
