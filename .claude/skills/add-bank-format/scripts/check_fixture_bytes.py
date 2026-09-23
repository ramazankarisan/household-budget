#!/usr/bin/env python3
"""Assert a bank CSV fixture is still the bytes it is supposed to be.

Fixtures are byte-exact test data, and the usual way they break is an editor being
helpful: re-encoding cp1252 to UTF-8, rewriting CRLF to LF, or trimming a trailing blank
line. Each of those makes an encoding test pass for the wrong reason instead of failing.

Usage:
    python3 check_fixture_bytes.py FILE --encoding cp1252|utf-8 [--bom]
                                        [--twin OTHER] [--allow-ragged]
"""

from __future__ import annotations

import argparse
import csv
import io
import subprocess
import sys
from pathlib import Path

BOM = b"\xef\xbb\xbf"


class Report:
    def __init__(self) -> None:
        self.failed = False

    def check(self, ok: bool, message: str) -> bool:
        print(f"{'PASS' if ok else 'FAIL'}  {message}")
        self.failed = self.failed or not ok
        return ok

    def note(self, message: str) -> None:
        print(f"      {message}")


def decode(raw: bytes, encoding: str) -> str:
    body = raw[len(BOM):] if encoding == "utf-8" and raw.startswith(BOM) else raw
    return body.decode(encoding)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--encoding", required=True, choices=["cp1252", "utf-8"])
    parser.add_argument("--bom", action="store_true", help="a UTF-8 BOM is expected")
    parser.add_argument("--twin", type=Path, help="a file whose decoded text must match")
    parser.add_argument("--delimiter", default=";")
    parser.add_argument(
        "--allow-ragged",
        action="store_true",
        help="for the bad-rows and malformed fixtures, where a broken row is the point",
    )
    args = parser.parse_args()

    report = Report()
    raw = args.file.read_bytes()
    report.check(len(raw) > 0, f"{args.file} is non-empty ({len(raw)} bytes)")

    # Line endings. A lone LF means something rewrote the file.
    lone_lf = sum(
        1 for i, b in enumerate(raw) if b == 0x0A and (i == 0 or raw[i - 1] != 0x0D)
    )
    report.check(lone_lf == 0, f"line endings are CRLF throughout ({lone_lf} lone LF)")

    has_bom = raw.startswith(BOM)
    report.check(has_bom == args.bom, f"BOM {'present' if has_bom else 'absent'} as expected")

    # Encoding. cp1252 decodes any byte sequence, so prove it is *not* UTF-8 instead:
    # that is the same argument decode.ts relies on at runtime.
    high_bytes = [b for b in raw if b >= 0x80]
    if args.encoding == "utf-8":
        try:
            raw.decode("utf-8")
            report.check(True, "decodes as UTF-8")
        except UnicodeDecodeError as error:
            report.check(False, f"decodes as UTF-8 — {error}")
    elif not high_bytes:
        report.note("pure ASCII: encoding is moot for this fixture")
    else:
        try:
            raw.decode("utf-8")
            report.check(False, "bytes are cp1252 — they decode as UTF-8, so they are not")
            report.note("an editor re-encoded this file; restore it from the generator")
        except UnicodeDecodeError:
            report.check(True, f"bytes are cp1252, not UTF-8 ({len(high_bytes)} high bytes)")

    text = decode(raw, args.encoding)

    # Field counts. A footer line or a shifted quote shows up here before it shows up as
    # a wrong number in a budget.
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=args.delimiter))
        data = [r for r in rows if r and any(f.strip() for f in r)]
        widths = sorted({len(r) for r in data})
        if args.allow_ragged:
            report.note(f"{len(data)} non-empty records, field counts {widths}")
        else:
            shape = f"all {widths[0]}" if len(widths) == 1 else f"mixed {widths}"
            report.check(len(widths) <= 1, f"{len(data)} records, {shape} fields wide")
    except csv.Error as error:
        report.check(args.allow_ragged, f"CSV structure — {error}")

    if args.twin is not None:
        # The twin is always the UTF-8 rendering of the same rows.
        twin_text = decode(args.twin.read_bytes(), "utf-8")
        report.check(
            text == twin_text,
            f"decoded content is identical to {args.twin}",
        )
        if text != twin_text and len(text) == len(twin_text):
            first = next(i for i, (a, b) in enumerate(zip(text, twin_text)) if a != b)
            report.note(f"first difference at character {first}: "
                        f"{text[first]!r} vs {twin_text[first]!r}")

    # Committable? fixtures/*.csv is the one exception to the repo's CSV ignore rule.
    ignored = subprocess.run(
        ["git", "check-ignore", str(args.file)], capture_output=True, text=True
    )
    report.check(ignored.returncode != 0, "not git-ignored, so it can be committed")

    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
