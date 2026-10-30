"""python -m pipeline.desk [folder or file] [--port 8790] [--no-browser]"""

import argparse
from pathlib import Path

from pipeline.desk.server import serve


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m pipeline.desk", description="The intake desk: sort a folder of papers into PDFs and manifests, on this laptop.")
    ap.add_argument("folder", type=Path, nargs="?", help="a folder of PDFs and photos, or one PDF (or pick one on the page)")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--no-browser", action="store_true", help="do not open the page in the browser")
    args = ap.parse_args()
    serve(args.folder, args.port, not args.no_browser)


if __name__ == "__main__":
    main()
