"""Harness step 1 (render): turn every PDF page into a PNG at 200 dpi.

Usage:
    python -m pipeline.render data/raw/davv-sdsf/mtech-aids-dual/sem1 --out data/work/pages
"""

import argparse
from pathlib import Path

import pymupdf

DEFAULT_DPI = 200


def render_pdf(pdf_path: Path, out_dir: Path, dpi: int = DEFAULT_DPI, force: bool = False) -> list[Path]:
    """Render each page of one PDF to <out_dir>/<pdf stem>_p<N>.png (N starts at 1)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    with pymupdf.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            png = out_dir / f"{pdf_path.stem}_p{i}.png"
            if force or not png.exists():
                page.get_pixmap(dpi=dpi).save(png)
            paths.append(png)
    return paths


def render_all(src: Path, out_dir: Path, dpi: int = DEFAULT_DPI, force: bool = False) -> dict[str, list[Path]]:
    """Render one PDF, or every PDF in a folder. Returns {pdf file name: [png paths]}."""
    pdfs = [src] if src.is_file() else sorted(src.glob("*.pdf"))
    return {pdf.name: render_pdf(pdf, out_dir, dpi, force) for pdf in pdfs}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", type=Path, help="a PDF file or a folder of PDFs")
    ap.add_argument("--out", type=Path, default=Path("data/work/pages"))
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    ap.add_argument("--force", action="store_true", help="re-render pages that already exist")
    args = ap.parse_args()

    for name, pngs in render_all(args.src, args.out, args.dpi, args.force).items():
        print(f"{name}: {len(pngs)} pages -> {args.out}")


if __name__ == "__main__":
    main()
