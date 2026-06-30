#!/usr/bin/env python3
"""
Build static track metadata for the 1001 Albums app.

Requires:
  python3 -m pip install SpotAPI pymongo redis websockets

Or run without installing into the project:
  uv run --with SpotAPI --with pymongo --with redis --with websockets 1001-albums/pipeline/scripts/fetch-1001-tracks.py

By default this fetches the book album catalog from /albums, scrapes each album page for Apple
Music IDs, fetches Spotify track metadata through SpotAPI, and writes
1001-albums/pipeline/data/book-tracks-data.json.

Use --catalog user --output 1001-albums/pipeline/data/user-tracks-data.json for the user-submitted catalog.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SITE_BASE = "https://1001albumsgenerator.com"
API_BASE = f"{SITE_BASE}/api/v1"
DEFAULT_OUTPUT = Path("1001-albums/pipeline/data/book-tracks-data.json")
USER_AGENT = "tools.robbiehickey.com track-data builder"


def get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def get_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="replace")


def pick_path(value: Any, paths: list[list[str]]) -> Any:
    for path in paths:
        cur = value
        for key in path:
            if isinstance(cur, dict) and key in cur:
                cur = cur[key]
            else:
                cur = None
                break
        if cur is not None:
            return cur
    return None


def spotify_id_from_uri(uri: str | None) -> str | None:
    if not uri:
        return None
    match = re.search(r"(?:spotify:track:|open\.spotify\.com/track/)([A-Za-z0-9]+)", uri)
    return match.group(1) if match else uri


def spotify_album_id_from_uri(uri: str | None) -> str | None:
    if not uri:
        return None
    match = re.search(r"(?:spotify:album:|open\.spotify\.com/album/)([A-Za-z0-9]+)", uri)
    return match.group(1) if match else uri


def first_artist_name(track: dict[str, Any]) -> str | None:
    artists = pick_path(track, [["artists"], ["artists", "items"]])
    if isinstance(artists, list) and artists:
        first = artists[0]
        if isinstance(first, dict):
            return pick_path(first, [["name"], ["profile", "name"]])
        if isinstance(first, str):
            return first
    return pick_path(track, [["artistName"], ["artist", "name"]])


def track_duration_ms(track: dict[str, Any]) -> int | None:
    value = pick_path(
        track,
        [
            ["durationMs"],
            ["duration_ms"],
            ["duration", "totalMilliseconds"],
            ["duration", "milliseconds"],
        ],
    )
    return value if isinstance(value, int) else None


def track_number(track: dict[str, Any], fallback: int) -> int | None:
    value = pick_path(track, [["trackNumber"], ["track_number"], ["number"]])
    return value if isinstance(value, int) else fallback


def disc_number(track: dict[str, Any]) -> int:
    value = pick_path(track, [["discNumber"], ["disc_number"], ["disc", "number"]])
    return value if isinstance(value, int) else 1


def normalize_spotify_track(item: Any, fallback_number: int, album: dict[str, Any]) -> dict[str, Any] | None:
    track = item.get("track") if isinstance(item, dict) and isinstance(item.get("track"), dict) else item
    if not isinstance(track, dict):
        return None

    track_id = spotify_id_from_uri(pick_path(track, [["id"], ["uri"], ["sharingInfo", "shareUrl"]]))
    title = pick_path(track, [["name"], ["title"]])
    if not title:
        return None

    share_url = pick_path(track, [["external_urls", "spotify"], ["sharingInfo", "shareUrl"], ["url"]])
    if not share_url and track_id:
        share_url = f"https://open.spotify.com/track/{track_id}"

    explicit = pick_path(track, [["explicit"], ["contentRating", "label"]])
    if isinstance(explicit, str):
        explicit = explicit.lower() == "explicit"

    playable = pick_path(track, [["playability", "playable"], ["streamable"]])

    value = {
        "discNumber": disc_number(track),
        "trackNumber": track_number(track, fallback_number),
        "title": title,
        "durationMs": track_duration_ms(track),
        "explicit": explicit if isinstance(explicit, bool) else None,
        "streamable": playable if isinstance(playable, bool) else None,
        "services": {"spotify": {"trackId": track_id, "url": share_url}},
    }
    artist_name = first_artist_name(track)
    if artist_name and artist_name != album.get("artist"):
        value["artist"] = artist_name
    if not track_id:
        value["services"].pop("spotify")
    if not value["services"]:
        value.pop("services")
    return {key: item for key, item in value.items() if item is not None}


def scrape_apple_music_id(album: dict[str, Any]) -> str | None:
    spotify_id = album.get("spotifyId")
    slug = album.get("slug")
    urls = []
    if spotify_id and slug:
        urls.append(f"{SITE_BASE}/user-albums/{urllib.parse.quote(spotify_id)}/{urllib.parse.quote(slug)}")
    if spotify_id:
        urls.append(f"{SITE_BASE}/albums/{urllib.parse.quote(spotify_id)}")

    for url in urls:
        try:
            text = html.unescape(get_text(url))
        except (urllib.error.URLError, TimeoutError):
            continue
        match = re.search(r"https?://music\.apple\.com/(?:[a-z]{2}/)?album/(?:[^\"'<>\s]+/)?(\d+)", text)
        if match:
            return match.group(1)
    return None


def split_csv_attr(value: str | None) -> list[str]:
    if not value:
        return []
    return [html.unescape(item).strip() for item in value.split(",") if item.strip()]


def parse_attrs(tag: str) -> dict[str, str]:
    return {
        key: html.unescape(value)
        for key, value in re.findall(r'([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"', tag)
    }


def fetch_book_catalog() -> list[dict[str, Any]]:
    text = get_text(f"{SITE_BASE}/albums")
    return parse_album_table(text, "book")


def parse_album_table(text: str, source: str) -> list[dict[str, Any]]:
    albums = []
    for attrs_text, body in re.findall(r"<tr\s+([^>]*)>(.*?)</tr>", text, re.S):
        attrs = parse_attrs(attrs_text)
        if "data-album" not in attrs or "data-artist" not in attrs:
            continue
        spotify_match = re.search(r'href="/(?:user-albums|albums)/([A-Za-z0-9]+)"', body)
        if not spotify_match:
            continue
        album = {
            "name": attrs["data-album"].strip(),
            "artist": attrs["data-artist"].strip(),
            "releaseDate": (attrs.get("data-release") or attrs.get("data-year") or "").strip(),
            "spotifyId": spotify_match.group(1),
            "genres": split_csv_attr(attrs.get("data-genres")),
            "styles": split_csv_attr(attrs.get("data-styles")),
            "catalogSource": source,
        }
        if attrs.get("data-number"):
            try:
                album["catalogNumber"] = int(attrs["data-number"])
            except ValueError:
                album["catalogNumber"] = attrs["data-number"].strip()
        albums.append(album)
    return albums


def fetch_user_catalog() -> list[dict[str, Any]]:
    text = get_text(f"{SITE_BASE}/user-albums")
    return parse_album_table(text, "user")


def fetch_catalog(source: str) -> list[dict[str, Any]]:
    if source == "book":
        return fetch_book_catalog()
    if source == "user":
        return fetch_user_catalog()
    raise ValueError(f"Unknown catalog source: {source}")


def spotapi_client() -> Any:
    try:
        from spotapi import Public
    except ModuleNotFoundError as err:
        print(
            f"Missing dependency ({err.name}): install with `python3 -m pip install SpotAPI pymongo redis websockets`.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return Public()


def fetch_spotify_tracks(client: Any, spotify_album_id: str) -> list[Any]:
    data = client.album_info(spotify_album_id)
    pages = list(data) if not isinstance(data, (dict, list)) else data
    if isinstance(pages, list) and pages and all(isinstance(page, list) for page in pages):
        return [item for page in pages for item in page]
    if isinstance(pages, dict):
        for key in ("tracks", "items"):
            value = pages.get(key)
            if isinstance(value, list):
                return value
    if isinstance(pages, list):
        return pages
    return []


def read_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "albums": {}}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if "albums" not in data or not isinstance(data["albums"], dict):
        data["albums"] = {}
    return data


def album_services(spotify_album_id: str | None, apple_album_id: str | None) -> dict[str, Any]:
    services: dict[str, Any] = {}
    if spotify_album_id:
        services["spotify"] = {"albumId": spotify_album_id}
    if apple_album_id:
        services["appleMusic"] = {"albumId": str(apple_album_id)}
    return services


def write_output(path: Path, data: dict[str, Any]) -> None:
    data["version"] = 1
    data["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    data["source"] = "1001-albums/pipeline/scripts/fetch-1001-tracks.py"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--catalog", choices=["book", "user"], default="book", help="Album catalog to enumerate.")
    parser.add_argument("--limit", type=int, default=0, help="Limit albums processed, useful for testing.")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between albums in seconds.")
    parser.add_argument("--force", action="store_true", help="Re-fetch albums already present in the output.")
    args = parser.parse_args()

    albums = fetch_catalog(args.catalog)
    if args.limit:
        albums = albums[: args.limit]

    output = read_existing(args.output)
    client = spotapi_client()

    for index, album in enumerate(albums, start=1):
        spotify_id = album["spotifyId"]
        album_metadata = {
            "name": album.get("name"),
            "artist": album.get("artist"),
            "releaseDate": album.get("releaseDate"),
            "genres": album.get("genres") or [],
            "styles": album.get("styles") or [],
            "catalogSource": album.get("catalogSource") or args.catalog,
            "catalogNumber": album.get("catalogNumber"),
            "spotifyAlbumId": spotify_album_id_from_uri(spotify_id),
        }
        if not args.force and output["albums"].get(spotify_id, {}).get("tracks"):
            existing = output["albums"][spotify_id]
            existing_album = existing.get("album") or {}
            existing["album"] = {
                **existing_album,
                **{key: value for key, value in album_metadata.items() if value not in (None, [], "")},
            }
            existing["services"] = album_services(
                album_metadata.get("spotifyAlbumId"),
                (existing.get("services") or {}).get("appleMusic", {}).get("albumId"),
            )
            output["albums"][spotify_id] = existing
            write_output(args.output, output)
            print(f"[{index}/{len(albums)}] skip {album.get('artist')} - {album.get('name')}")
            continue

        print(f"[{index}/{len(albums)}] fetch {album.get('artist')} - {album.get('name')} ({spotify_id})")
        try:
            apple_album_id = scrape_apple_music_id(album)
            raw_tracks = fetch_spotify_tracks(client, spotify_id)
            tracks = [
                track
                for pos, item in enumerate(raw_tracks, start=1)
                if (track := normalize_spotify_track(item, pos, album))
            ]
            tracks.sort(key=lambda t: ((t.get("discNumber") or 1), (t.get("trackNumber") or 0)))
            error = None
        except Exception as err:
            apple_album_id = None
            tracks = []
            error = {
                "type": type(err).__name__,
                "message": str(err),
                "failedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            }
            print(f"  error: {error['type']}: {error['message']}", file=sys.stderr)

        output["albums"][spotify_id] = {
            "album": {
                **album_metadata,
                "trackCount": len(tracks),
                "totalRuntimeMs": sum(track.get("durationMs") or 0 for track in tracks) or None,
            },
            "services": album_services(album_metadata.get("spotifyAlbumId"), apple_album_id),
            "tracks": tracks,
        }
        if error:
            output["albums"][spotify_id]["error"] = error
        write_output(args.output, output)
        if args.delay and index < len(albums):
            time.sleep(args.delay)

    print(f"Wrote {len(output['albums'])} albums to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
