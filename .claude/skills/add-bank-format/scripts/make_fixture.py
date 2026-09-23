#!/usr/bin/env python3
"""Generate every variant of a bank CSV fixture from one row set.

Why a script and not hand-edited files: the variants of a fixture (primary encoding,
UTF-8 twin, BOM, narrow column shape, bad rows, overlapping next export) only mean
anything while they agree about the rows they share. Hand-edited, they drift, and the
test asserting two shapes parse identically starts passing for the wrong reason.

Why Python and not Node: cp1252 needs an *encoder*. `TextEncoder` is UTF-8 only by spec,
and Buffer's 'latin1' is not cp1252 — they diverge exactly at 0x80-0x9F, where the €
sign and curly quotes live. Python's cp1252 codec is exact and built in.

Usage:
    python3 make_fixture.py spec.json [--out-dir DIR] [--dry-run]

See fixture-spec.example.json for a filled-in spec.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CRLF = "\r\n"


def quote_field(value: str, delimiter: str, mode: str, is_first: bool) -> str:
    """Render one field. Quoting is per-bank, so it is a spec knob, not a constant."""
    escaped = value.replace('"', '""')
    needs_quotes = (
        delimiter in value or '"' in value or "\n" in value or "\r" in value
    )
    if mode == "all":
        return f'"{escaped}"'
    if mode == "all-but-first":
        return escaped if is_first and not needs_quotes else f'"{escaped}"'
    if mode == "minimal":
        return f'"{escaped}"' if needs_quotes else escaped
    raise SystemExit(f"unknown quote mode {mode!r}: use all, all-but-first or minimal")


def render_row(
    row: dict[str, str], columns: list[str], delimiter: str, quote: str
) -> str:
    return delimiter.join(
        quote_field(str(row.get(name, "")), delimiter, quote, index == 0)
        for index, name in enumerate(columns)
    )


def apply_variant(spec: dict, variant: dict) -> tuple[list[str], list[dict], list[int]]:
    """Resolve a variant against the shared row set. Rows are copied, never mutated.

    Every index in a variant — `patch`, `blankAfterRow`, `onlyRows` — counts rows in the
    shared `rows` array, which is the only numbering a spec author can see. Resolving
    them against the already-filtered list instead would move a patch to a different row
    the moment `onlyRows` changed, and the file would still generate: a silently wrong
    fixture, which is the failure this whole script exists to prevent.
    """
    columns = [c for c in spec["columns"] if c not in variant.get("dropColumns", [])]
    shared = [dict(row) for row in spec["rows"]]

    for patch in variant.get("patch", []):
        index = patch["row"]
        if not 0 <= index < len(shared):
            raise SystemExit(f"patch targets row {index}; the spec has {len(shared)} rows")
        shared[index].update(patch["set"])

    kept = variant.get("onlyRows")
    if kept is None:
        rows, position = shared, {i: i for i in range(len(shared))}
    else:
        for index in kept:
            if not 0 <= index < len(shared):
                raise SystemExit(f"onlyRows names row {index}; the spec has {len(shared)} rows")
        patched = {p["row"] for p in variant.get("patch", [])}
        dropped = sorted(patched - set(kept))
        if dropped:
            raise SystemExit(
                f"patch targets row(s) {dropped} that onlyRows leaves out — "
                "the edit would vanish silently"
            )
        rows = [shared[i] for i in kept]
        position = {original: new for new, original in enumerate(kept)}

    appended = [dict(row) for row in variant.get("appendRows", [])]
    rows = rows + appended

    blanks = []
    for b in variant.get("blankAfterRow", spec.get("blankAfterRow", [])):
        if b not in position:
            raise SystemExit(
                f"blankAfterRow names row {b}, which this variant does not contain"
            )
        blanks.append(position[b])
    return columns, rows, blanks


def build_text(spec: dict, variant: dict) -> str:
    columns, rows, blanks = apply_variant(spec, variant)
    delimiter = spec.get("delimiter", ";")
    quote = spec.get("quote", "all-but-first")

    lines: list[str] = list(variant.get("preamble", spec.get("preamble", [])))
    lines.append(render_row({c: c for c in columns}, columns, delimiter, quote))

    for index, row in enumerate(rows):
        lines.append(render_row(row, columns, delimiter, quote))
        if index in blanks:
            lines.append("")

    text = CRLF.join(lines) + CRLF
    if variant.get("trailingBlank", spec.get("trailingBlank", False)):
        text += CRLF
    # Raw tail for deliberately broken fixtures: an unterminated quote cannot be
    # expressed as a well-formed row, and a malformed fixture is exactly the point.
    text += variant.get("appendRaw", "")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    out_dir = args.out_dir or Path(spec.get("outDir", "fixtures"))
    name = spec["name"]

    for variant in spec["variants"]:
        text = build_text(spec, variant)
        encoding = variant.get("encoding", "cp1252")
        payload = text.encode(encoding)  # strict: an un-encodable char must fail loudly
        if variant.get("bom"):
            if encoding != "utf-8":
                raise SystemExit("a BOM only makes sense on the utf-8 variants")
            payload = b"\xef\xbb\xbf" + payload

        path = out_dir / f"{name}{variant.get('suffix', '')}.csv"
        if args.dry_run:
            print(f"would write {path} ({len(payload)} bytes, {encoding})")
            continue

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        print(f"wrote {path} ({len(payload)} bytes, {encoding}"
              f"{', BOM' if variant.get('bom') else ''})")

    if not args.dry_run:
        primary = spec["variants"][0]
        flags = f"--encoding {primary.get('encoding', 'cp1252')}"
        if primary.get("bom"):
            flags += " --bom"
        print("\nNow verify the bytes:")
        print(f"  python3 {Path(__file__).with_name('check_fixture_bytes.py')} "
              f"{out_dir / (name + primary.get('suffix', '') + '.csv')} {flags}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
