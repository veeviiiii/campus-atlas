"""The sources in a folder: PDFs (every page) and photos (one page each), in subfolders too; or one
file on its own.

A source page is named by the file's path inside the folder and its page number: "Sem-5 Test Papers.pdf#3".
"""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps

from pipeline.intake import PHOTOS
from pipeline.render import DEFAULT_DPI

PREVIEW_SIDE = 1400  # px, longest side of the picture the desk page edits on
SMALL_SIDE = 480  # px, longest side of the picture the small cards are cut from


@dataclass
class Source:
    id: str  # path inside the folder, with forward slashes
    kind: str  # "pdf" or "photo"
    pages: int


def is_source_name(name: str) -> bool:
    suffix = Path(name).suffix.lower()
    return (suffix == ".pdf" or suffix in PHOTOS) and not name.startswith(".")


def is_source(p: Path) -> bool:
    return p.is_file() and is_source_name(p.name)


def list_sources(folder: Path, only: str = "") -> tuple[list[Source], list[str]]:
    """The sources (just `only`, a file in the folder, when given), and the PDFs that would not open
    (a broken download; the desk page names them)."""
    out, broken = [], []
    files = [folder / only] if only else sorted(folder.rglob("*"), key=lambda p: p.relative_to(folder).as_posix().lower())
    for p in files:
        suffix = p.suffix.lower()
        if not is_source(p):
            continue
        rel = p.relative_to(folder).as_posix()
        if suffix == ".pdf":
            try:
                with pymupdf.open(p) as doc:
                    out.append(Source(rel, "pdf", doc.page_count))
            except Exception:
                broken.append(rel)
        else:
            out.append(Source(rel, "photo", 1))
    return out, broken


def page_key(src: str, page: int) -> str:
    return f"{src}#{page}"


def _pdf_page(pg, max_side: int | None) -> Image.Image:
    dpi = DEFAULT_DPI
    if max_side:
        dpi = min(DEFAULT_DPI, max(20, int(72 * max_side / max(pg.rect.width, pg.rect.height))))
    pix = pg.get_pixmap(dpi=dpi, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def load_page(folder: Path, src: str, page: int, max_side: int | None = None) -> Image.Image:
    """One source page as an RGB image: a PDF page at 200 dpi (as the pipeline renders), a photo turned
    upright by its EXIF tag (as intake photos does). max_side: a smaller picture for the desk page."""
    path = folder / src
    if path.suffix.lower() == ".pdf":
        with pymupdf.open(path) as doc:
            return _pdf_page(doc[page - 1], max_side)
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if max_side:
        img.thumbnail((max_side, max_side))
    return img


def load_pages(folder: Path, src: str, max_side: int | None = None) -> Iterator[Image.Image]:
    """Every page of one source in order, as load_page gives them; a PDF is opened once for all its pages."""
    path = folder / src
    if path.suffix.lower() == ".pdf":
        with pymupdf.open(path) as doc:
            for pg in doc:
                yield _pdf_page(pg, max_side)
    else:
        yield load_page(folder, src, 1, max_side)


def stamp(path: Path) -> str:
    """Size and time of a file: what the desk's caches (small pictures, fingerprints) are kept by."""
    st = path.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"
