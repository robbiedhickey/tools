#!/usr/bin/env python3
"""
Build a Spotify album ID to Wikipedia URL enrichment map.

Prefer 1001albumsgenerator Album DTOs when available because those URLs are already curated by
the upstream site. For remaining albums, optionally use Wikipedia's public search/summary APIs.

Usage:
  uv run 1001-albums/pipeline/scripts/build-wikipedia-map.py --project hodorswit
  uv run 1001-albums/pipeline/scripts/build-wikipedia-map.py --project hodorswit --search-missing
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SITE_BASE = "https://1001albumsgenerator.com"
API_BASE = f"{SITE_BASE}/api/v1"
BOOK_DATA = Path("1001-albums/pipeline/data/book-tracks-data.json")
USER_DATA = Path("1001-albums/pipeline/data/user-tracks-data.json")
OUTPUT = Path("1001-albums/pipeline/data/wikipedia-map.json")
USER_AGENT = "tools.robbiehickey.com/1001-albums wikipedia-map builder (https://tools.robbiehickey.com)"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def get_json(url: str, retries: int = 4) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt >= retries:
                raise
            retry_after = err.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after else 60.0 * (attempt + 1)
            except ValueError:
                delay = 60.0 * (attempt + 1)
            print(f"  rate limited by API; sleeping {delay:.0f}s before retry")
            time.sleep(delay)
    raise RuntimeError("unreachable")


def canonical_album_id(album: dict[str, Any]) -> str | None:
    global_reviews_url = album.get("globalReviewsUrl") or ""
    match = re.search(r"/(?:albums|user-albums)/([A-Za-z0-9]+)", global_reviews_url)
    if match:
        return match.group(1)
    return album.get("spotifyId") or album.get("spotifyAlbumId")


def wiki_title_from_url(url: str) -> str | None:
    parsed = urllib.parse.urlparse(url)
    if not parsed.netloc.endswith("wikipedia.org"):
        return None
    marker = "/wiki/"
    if marker not in parsed.path:
        return None
    return urllib.parse.unquote(parsed.path.split(marker, 1)[1])


def normalize_wikipedia_url(url: str | None) -> str | None:
    if not url:
        return None
    title = wiki_title_from_url(url)
    if not title:
        return None
    return f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'), safe='()_')}"


def iter_album_dtos(value: Any) -> list[dict[str, Any]]:
    albums: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if value.get("wikipediaUrl") and (value.get("spotifyId") or value.get("globalReviewsUrl")):
            albums.append(value)
        for item in value.values():
            albums.extend(iter_album_dtos(item))
    elif isinstance(value, list):
        for item in value:
            albums.extend(iter_album_dtos(item))
    return albums


def upsert_album_dto(mapping: dict[str, Any], album: dict[str, Any], source: str) -> bool:
    spotify_id = canonical_album_id(album)
    url = normalize_wikipedia_url(album.get("wikipediaUrl"))
    if not spotify_id or not url:
        return False
    existing = mapping.setdefault("albums", {}).get(spotify_id) or {}
    if existing.get("url") == url and existing.get("source") == source:
        return False
    mapping["albums"][spotify_id] = {
        "url": url,
        "source": source,
        "name": album.get("name"),
        "artist": album.get("artist"),
        "updatedAt": utc_now(),
    }
    return True


def catalog_rows(paths: list[Path]) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for path in paths:
        data = read_json(path)
        for spotify_id, record in (data.get("albums") or {}).items():
            album = record.get("album") or {}
            rows[spotify_id] = {
                "spotifyId": spotify_id,
                "name": album.get("name"),
                "artist": album.get("artist"),
                "releaseDate": album.get("releaseDate"),
            }
    return rows


def wikipedia_search(album: dict[str, Any], delay: float) -> dict[str, Any] | None:
    terms = [
        f"{album.get('name')} {album.get('artist')} album",
        f"{album.get('name')} album",
    ]
    for term in terms:
        params = urllib.parse.urlencode(
            {
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": term,
                "gsrlimit": 5,
                "prop": "info|pageprops|description",
                "inprop": "url",
                "redirects": 1,
                "maxlag": 5,
            }
        )
        data = get_json(f"https://en.wikipedia.org/w/api.php?{params}")
        if delay:
            time.sleep(delay)
        pages = list((data.get("query") or {}).get("pages", {}).values())
        pages.sort(key=lambda page: page.get("index", 999))
        for page in pages:
            title = page.get("title") or ""
            description = (page.get("description") or "").lower()
            if "album" not in title.lower() and "album" not in description:
                continue
            url = normalize_wikipedia_url(page.get("fullurl"))
            if url:
                return {"url": url, "source": "wikipedia-search", "matchTitle": title}
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book-data", type=Path, default=BOOK_DATA)
    parser.add_argument("--user-data", type=Path, default=USER_DATA)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--project", action="append", default=[], help="Seed from /api/v1/projects/{name}. May be repeated.")
    parser.add_argument("--group", action="append", default=[], help="Seed from /api/v1/groups/{slug}. May be repeated.")
    parser.add_argument("--include-group-members", action="store_true", help="Fetch each group member project after the group summary.")
    parser.add_argument("--search-missing", action="store_true", help="Use Wikipedia search for catalog albums not found in 1001albumsgenerator Album DTOs.")
    parser.add_argument("--force", action="store_true", help="Refresh existing Wikipedia-search rows.")
    parser.add_argument("--limit", type=int, default=0, help="Limit missing albums searched via Wikipedia.")
    parser.add_argument("--site-delay", type=float, default=20.0, help="Delay between 1001albumsgenerator API requests.")
    parser.add_argument("--wiki-delay", type=float, default=0.2, help="Delay between Wikipedia API requests.")
    args = parser.parse_args()

    output_exists = args.output.exists()
    mapping = read_json(args.output) or {}
    mapping.setdefault("version", 1)
    mapping.setdefault("albums", {})
    mapping.setdefault("misses", {})
    dirty = not output_exists

    site_requests = 0
    dto_updates = 0
    projects = list(dict.fromkeys(args.project))

    for group in args.group:
        data = get_json(f"{API_BASE}/groups/{urllib.parse.quote(group)}")
        site_requests += 1
        for album in iter_album_dtos(data):
            changed = upsert_album_dto(mapping, album, f"1001albumsgenerator:group:{group}")
            dto_updates += int(changed)
            dirty = dirty or changed
        if args.include_group_members:
            for member in data.get("members") or []:
                name = member.get("name") if isinstance(member, dict) else None
                if name:
                    projects.append(name)
        if args.site_delay:
            time.sleep(args.site_delay)

    for project in dict.fromkeys(projects):
        data = get_json(f"{API_BASE}/projects/{urllib.parse.quote(project)}")
        site_requests += 1
        for album in iter_album_dtos(data):
            changed = upsert_album_dto(mapping, album, f"1001albumsgenerator:project:{project}")
            dto_updates += int(changed)
            dirty = dirty or changed
        if args.site_delay:
            time.sleep(args.site_delay)

    searched = 0
    search_updates = 0
    if args.search_missing:
        rows = catalog_rows([args.book_data, args.user_data])
        missing = [
            album for spotify_id, album in rows.items()
            if args.force or (spotify_id not in mapping["albums"] and spotify_id not in mapping["misses"])
        ]
        if args.limit:
            missing = missing[: args.limit]
        for index, album in enumerate(missing, start=1):
            print(f"[{index}/{len(missing)}] search {album.get('artist')} - {album.get('name')}")
            match = wikipedia_search(album, args.wiki_delay)
            searched += 1
            if match:
                mapping["albums"][album["spotifyId"]] = {
                    "url": match["url"],
                    "source": match["source"],
                    "matchTitle": match.get("matchTitle"),
                    "name": album.get("name"),
                    "artist": album.get("artist"),
                    "updatedAt": utc_now(),
                }
                search_updates += 1
                dirty = True
            else:
                mapping["misses"][album["spotifyId"]] = {
                    "name": album.get("name"),
                    "artist": album.get("artist"),
                    "searchedAt": utc_now(),
                    "source": "wikipedia-search",
                }
                dirty = True
            write_json(args.output, {**mapping, "generatedAt": utc_now()})

    if dirty:
        write_json(args.output, {**mapping, "generatedAt": utc_now()})
    print(
        f"Wrote {len(mapping['albums'])} Wikipedia URLs to {args.output} "
        f"({dto_updates} DTO updates, {search_updates}/{searched} search matches, {site_requests} site requests)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
