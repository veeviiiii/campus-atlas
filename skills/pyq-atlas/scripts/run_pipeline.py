"""Thin wrapper around the campus-atlas pipeline (the PYQ Trust Harness).

Run from anywhere inside a clone of the campus-atlas repository:
    python skills/pyq-atlas/scripts/run_pipeline.py --manifest <path/to/manifest.yaml> --all
All arguments are passed to `python -m pipeline.build_pack` (see --help).
"""

import os
import sys
from pathlib import Path


def find_repo_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / "pipeline" / "build_pack.py").exists():
            return p
    return None


def main() -> int:
    root = find_repo_root(Path(__file__).resolve().parent) or find_repo_root(Path.cwd())
    if root is None:
        print("error: could not find the campus-atlas repository (no pipeline/build_pack.py above this script).", file=sys.stderr)
        return 2
    if not (root / ".env").exists():
        print(f"error: {root / '.env'} is missing. Copy .env.example to .env and set the model provider.", file=sys.stderr)
        return 2
    try:
        import pydantic, pymupdf, yaml  # noqa: F401, E401
    except ImportError as e:
        print(f"error: missing dependency ({e.name}). Run: python -m pip install -r {root / 'pipeline' / 'requirements.txt'}", file=sys.stderr)
        return 2

    os.chdir(root)
    sys.path.insert(0, str(root))
    from pipeline.build_pack import main as build_pack_main

    build_pack_main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
