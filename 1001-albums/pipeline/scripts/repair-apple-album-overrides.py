#!/usr/bin/env python3
"""
Find better Apple Music album IDs for albums whose current Apple track mapping is incomplete.

The script searches Apple's public iTunes catalog by album + artist, looks up each candidate's
track list, scores it against the Spotify tracks already harvested by the pipeline, and writes a
reviewable report. With --apply, high-confidence candidates are added to
1001-albums/pipeline/data/apple-album-overrides.json.

Examples:
  uv run 1001-albums/pipeline/scripts/repair-apple-album-overrides.py --limit 25
  uv run 1001-albums/pipeline/scripts/repair-apple-album-overrides.py --apply --min-ratio 0.8
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


BOOK_DATA = Path("1001-albums/pipeline/data/book-tracks-data.json")
USER_DATA = Path("1001-albums/pipeline/data/user-tracks-data.json")
APPLE_MAP = Path("1001-albums/pipeline/data/apple-track-map.json")
APPLE_ALBUM_OVERRIDES = Path("1001-albums/pipeline/data/apple-album-overrides.json")
DEFAULT_REPORT = Path("1001-albums/pipeline/data/apple-album-repair-candidates.json")
USER_AGENT = "tools.robbiehickey.com apple-album repair"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"\([^)]*\)|\[[^]]*\]", "", text)
    text = re.sub(
        r"\b(remaster(?:ed)?|mono|stereo|deluxe|expanded|anniversary|edition|version|explicit|clean|bonus|digital)\b",
        " ",
        text,
    )
    text = re.sub(r"\b(19|20)\d{2}\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def token_overlap(left: str, right: str) -> float:
    left_tokens = set(normalize_text(left).split())
    right_tokens = set(normalize_text(right).split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def fetch_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
    req = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def search_apple_albums(album: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    term = " ".join(part for part in [album.get("artist"), album.get("name")] if part)
    data = fetch_json(
        "https://itunes.apple.com/search",
        {"term": term, "entity": "album", "country": "US", "media": "music", "limit": limit},
    )
    return [row for row in data.get("results") or [] if row.get("collectionId")]


def lookup_apple_tracks(apple_album_id: str) -> list[dict[str, Any]]:
    data = fetch_json(
        "https://itunes.apple.com/lookup",
        {"id": apple_album_id, "entity": "song", "country": "US", "media": "music"},
    )
    rows = [
        row
        for row in data.get("results") or []
        if row.get("wrapperType") == "track" and row.get("kind") == "song"
    ]
    rows.sort(key=lambda row: (row.get("discNumber") or 1, row.get("trackNumber") or 0))
    return rows


def spotify_track_id(track: dict[str, Any]) -> str | None:
    value = ((track.get("services") or {}).get("spotify") or {}).get("trackId")
    return str(value) if value else None


def match_track(spotify_track: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    disc = spotify_track.get("discNumber") or 1
    number = spotify_track.get("trackNumber")
    title = normalize_text(spotify_track.get("title"))
    duration = spotify_track.get("durationMs")

    same_position = [
        row
        for row in candidates
        if (row.get("discNumber") or 1) == disc and row.get("trackNumber") == number
    ]
    if len(same_position) == 1 and normalize_text(same_position[0].get("trackName")) == title:
        return same_position[0]

    title_matches = [row for row in candidates if normalize_text(row.get("trackName")) == title]
    if duration is not None:
        close = [
            row
            for row in title_matches
            if row.get("trackTimeMillis") is not None
            and abs(row["trackTimeMillis"] - duration) <= max(5000, int(duration * 0.03))
        ]
        if len(close) == 1:
            return close[0]
    if len(title_matches) == 1:
        return title_matches[0]
    return None


def score_candidate(record: dict[str, Any], candidate: dict[str, Any], apple_tracks: list[dict[str, Any]]) -> dict[str, Any]:
    spotify_tracks = [track for track in record.get("tracks") or [] if spotify_track_id(track)]
    mapped = 0
    for track in spotify_tracks:
        if match_track(track, apple_tracks):
            mapped += 1
    track_count = len(spotify_tracks)
    apple_track_count = len(apple_tracks)
    ratio = mapped / track_count if track_count else 0
    album = record.get("album") or {}
    return {
        "appleMusicId": str(candidate["collectionId"]),
        "artist": candidate.get("artistName"),
        "name": candidate.get("collectionName"),
        "releaseDate": candidate.get("releaseDate"),
        "trackCount": apple_track_count,
        "mappedCount": mapped,
        "ratio": round(ratio, 4),
        "titleScore": round(token_overlap(album.get("name"), candidate.get("collectionName")), 4),
        "artistScore": round(token_overlap(album.get("artist"), candidate.get("artistName")), 4),
        "trackCountDelta": abs(track_count - apple_track_count),
    }


def load_records(paths: list[Path]) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for path in paths:
        data = read_json(path)
        for spotify_id, record in (data.get("albums") or {}).items():
            if not isinstance(record, dict):
                continue
            records[spotify_id] = {**record, "_sourcePath": str(path)}
    return records


def gap_album_ids(records: dict[str, dict[str, Any]], apple_map: dict[str, Any], include_partials: bool) -> list[str]:
    ids = []
    for spotify_id, record in records.items():
        tracks = [track for track in record.get("tracks") or [] if spotify_track_id(track)]
        if not tracks:
            continue
        current = (apple_map.get("albums") or {}).get(spotify_id) or {}
        mapped = current.get("mappedCount", 0)
        if mapped == 0 or (include_partials and mapped < len(tracks)):
            ids.append(spotify_id)
    return sorted(ids)


def is_confident(candidate: dict[str, Any], track_count: int, min_ratio: float, min_mapped: int) -> bool:
    if candidate["mappedCount"] < min(min_mapped, track_count):
        return False
    return candidate["ratio"] >= min_ratio and candidate["titleScore"] >= 0.5 and candidate["artistScore"] >= 0.5


def update_overrides(overrides: dict[str, Any], spotify_id: str, record: dict[str, Any], apple_music_id: str) -> None:
    album = record.get("album") or {}
    overrides.setdefault("albums", {})
    override = overrides["albums"].setdefault(spotify_id, {})
    override["appleMusicId"] = apple_music_id
    override["name"] = album.get("name")
    override["artist"] = album.get("artist")
    override["catalogSource"] = album.get("catalogSource")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book-data", type=Path, default=BOOK_DATA)
    parser.add_argument("--user-data", type=Path, default=USER_DATA)
    parser.add_argument("--apple-map", type=Path, default=APPLE_MAP)
    parser.add_argument("--apple-album-overrides", type=Path, default=APPLE_ALBUM_OVERRIDES)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--search-limit", type=int, default=15)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--include-partials", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--min-ratio", type=float, default=0.8)
    parser.add_argument("--min-mapped", type=int, default=3)
    args = parser.parse_args()

    records = load_records([args.book_data, args.user_data])
    apple_map = read_json(args.apple_map)
    overrides = read_json(args.apple_album_overrides) if args.apple_album_overrides.exists() else {"version": 1, "albums": {}}
    report = read_json(args.report) if args.report.exists() else {
        "version": 1,
        "generatedAt": utc_now(),
        "searchedCount": 0,
        "appliedCount": 0,
        "rows": [],
    }
    report_rows = report.setdefault("rows", [])
    completed_ids = {
        row.get("spotifyAlbumId")
        for row in report_rows
        if isinstance(row, dict) and row.get("spotifyAlbumId")
    }
    ids = [spotify_id for spotify_id in gap_album_ids(records, apple_map, args.include_partials) if spotify_id not in completed_ids]
    if args.limit:
        ids = ids[: args.limit]

    applied = 0
    for index, spotify_id in enumerate(ids, start=1):
        record = records[spotify_id]
        album = record.get("album") or {}
        print(f"[{index}/{len(ids)}] search {album.get('artist')} - {album.get('name')} ({spotify_id})", flush=True)
        candidates = []
        try:
            for candidate in search_apple_albums(album, args.search_limit):
                tracks = lookup_apple_tracks(str(candidate["collectionId"]))
                candidates.append(score_candidate(record, candidate, tracks))
                if args.delay:
                    time.sleep(args.delay)
        except Exception as err:
            report_rows.append({
                "spotifyAlbumId": spotify_id,
                "album": {"name": album.get("name"), "artist": album.get("artist")},
                "error": {"type": type(err).__name__, "message": str(err)},
                "candidates": [],
            })
            report["generatedAt"] = utc_now()
            report["searchedCount"] = len(report_rows)
            report["appliedCount"] = (report.get("appliedCount") or 0) + applied
            write_json(args.report, report)
            continue

        candidates.sort(
            key=lambda item: (
                item["mappedCount"],
                item["ratio"],
                item["titleScore"],
                item["artistScore"],
                -item["trackCountDelta"],
            ),
            reverse=True,
        )
        best = candidates[0] if candidates else None
        track_count = len([track for track in record.get("tracks") or [] if spotify_track_id(track)])
        if args.apply and best and is_confident(best, track_count, args.min_ratio, args.min_mapped):
            update_overrides(overrides, spotify_id, record, best["appleMusicId"])
            applied += 1
            overrides["version"] = 1
            overrides["generatedAt"] = utc_now()
            write_json(args.apple_album_overrides, overrides)

        report_rows.append({
            "spotifyAlbumId": spotify_id,
            "album": {"name": album.get("name"), "artist": album.get("artist"), "trackCount": track_count},
            "currentAppleMusicId": (((record.get("services") or {}).get("appleMusic") or {}).get("albumId")),
            "best": best,
            "candidates": candidates[:5],
        })
        report["generatedAt"] = utc_now()
        report["searchedCount"] = len(report_rows)
        report["appliedCount"] = (report.get("appliedCount") or 0) + applied
        write_json(args.report, report)
        applied = 0
    if args.apply:
        overrides["version"] = 1
        overrides["generatedAt"] = utc_now()
        write_json(args.apple_album_overrides, overrides)
    print(f"Wrote {args.report} ({len(report_rows)} rows, {report.get('appliedCount') or 0} applied)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
