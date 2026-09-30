#!/usr/bin/env python3
"""Read a binary or XML property list on Windows and emit JSON.

`plutil` only exists on macOS, but CI and this workstation are Windows, so the
iOS verifier uses Python's stdlib `plistlib` instead. A dotted key argument
prints just that value.
"""
import json
import plistlib
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: plist2json.py <file.plist> [dotted.key]", file=sys.stderr)
        return 2

    with open(sys.argv[1], "rb") as fh:
        data = plistlib.load(fh)

    if len(sys.argv) > 2:
        cur = data
        for part in sys.argv[2].split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            else:
                cur = None
                break
        if isinstance(cur, bytes):
            print(f"<binary {len(cur)} bytes>")
        else:
            print(json.dumps(cur, indent=2, default=str))
    else:
        print(json.dumps(data, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
