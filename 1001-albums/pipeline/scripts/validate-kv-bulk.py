#!/usr/bin/env python3
"""
Validate the generated Wrangler KV bulk file against the KV album JSON Schema.

Usage:
  uv run --with jsonschema 1001-albums/pipeline/scripts/validate-kv-bulk.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator


DEFAULT_INPUT = Path("1001-albums/pipeline/data/tracks-kv-bulk.json")
DEFAULT_SCHEMA = Path("1001-albums/pipeline/schemas/kv-album.schema.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    args = parser.parse_args()

    schema = json.loads(args.schema.read_text())
    validator = Draft202012Validator(schema)
    rows = json.loads(args.input.read_text())

    error_count = 0
    for index, row in enumerate(rows, start=1):
        value = json.loads(row["value"])
        errors = sorted(validator.iter_errors(value), key=lambda err: list(err.path))
        if errors:
            error_count += len(errors)
            print(f"{row.get('key', f'row {index}')} failed validation:")
            for err in errors[:10]:
                path = ".".join(str(part) for part in err.path) or "<root>"
                print(f"  {path}: {err.message}")

    if error_count:
        print(f"Validation failed with {error_count} errors")
        return 1
    print(f"Validated {len(rows)} KV album records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
