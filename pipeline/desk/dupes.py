"""Pages that look the same, by a picture fingerprint (no model): the same scan or photo sent twice,
in the open folder or already in data/raw/ (the papers that are in a manifest).

Two different photos of one paper do not match; once their subject and exam are set, the plan's
"already has this subject in this exam" warning catches those. A page's fingerprint is compared in all
four turns, so a copy that was turned still matches.
"""

import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps

from pipeline import intake
from pipeline.desk.sources import Source, load_page, page_key

SIDE = 16  # the fingerprint compares each cell of a 16 x 16 grid with its right and lower neighbour: 512 bits
# Copies of one picture (turned, JPEG at quality 40) differed by up to 42 bits on the M.Tech AIDS folder;
# two different pages by 83 or more (62 for made-up pages of plain lines of text).
SAME = 48
BLANK = 2.0  # a page this even (grey levels) is blank and matches nothing; faint pages are stretched first
EMPTY = 40  # a fingerprint with fewer bits set is a nearly empty page (one stamp, a page number): it matches nothing.
# Pages of that folder set 70 to 330; a white page with one small box sets 15.
SMALL = 200  # px: pages are rendered this small to take a fingerprint
CACHE = "data/work/desk/fingerprints.json"  # PDFs in data/raw/, by path, size and time


def fingerprint(img: Image.Image) -> int | None:
    """A difference hash: for each cell, is it brighter than the cell to its right, and than the cell
    below it. None for a blank or nearly empty page (they all look alike)."""
    g = img.convert("L").resize((SIDE + 1, SIDE + 1), Image.BILINEAR)
    px = list(g.tobytes())
    mean = sum(px) / len(px)
    if (sum((p - mean) ** 2 for p in px) / len(px)) ** 0.5 < BLANK:
        return None
    px = list(ImageOps.autocontrast(g).tobytes())  # a faint photo of a page still has its layout
    w, bits = SIDE + 1, 0
    for y in range(SIDE):
        for x in range(SIDE):
            here = px[y * w + x]
            bits = (bits << 2) | (here > px[y * w + x + 1]) << 1 | (here > px[(y + 1) * w + x])
    return bits if bits.bit_count() >= EMPTY else None


def fingerprints(img: Image.Image) -> list[int] | None:
    """The fingerprint of the picture in each of its four turns."""
    first = fingerprint(img)
    if first is None:
        return None
    return [first] + [fingerprint(img.transpose(t)) or 0 for t in (Image.Transpose.ROTATE_270, Image.Transpose.ROTATE_180, Image.Transpose.ROTATE_90)]


def same(a: list[int], b: list[int]) -> bool:
    return min((x ^ b[0]).bit_count() for x in a) <= SAME


def raw_pdfs(skip: set[Path]) -> list[Path]:
    raw = intake.ROOT / "data" / "raw"
    return [p for p in sorted(raw.rglob("*.pdf")) if p.resolve() not in skip] if raw.exists() else []


def raw_fingerprints(paths: list[Path]) -> dict[str, list]:
    """{"data/raw/.../x.pdf": [fingerprints of page 1, page 2, ...]}, cached by size and time."""
    cache_path = intake.ROOT / CACHE
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    out, changed = {}, False
    for p in paths:
        rel = p.relative_to(intake.ROOT).as_posix()
        stamp = f"{p.stat().st_size}:{p.stat().st_mtime_ns}"
        if cache.get(rel, {}).get("stamp") != stamp:
            try:
                with pymupdf.open(p) as doc:
                    pages = []
                    for pg in doc:
                        pix = pg.get_pixmap(dpi=max(20, int(72 * SMALL / max(pg.rect.width, pg.rect.height))), alpha=False)
                        pages.append(fingerprints(Image.frombytes("RGB", (pix.width, pix.height), pix.samples)))
            except Exception:
                continue  # a broken PDF matches nothing
            cache[rel] = {"stamp": stamp, "pages": pages}
            changed = True
        out[rel] = cache[rel]["pages"]
    if changed:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
    return out


def find(folder: Path, sources: list[Source], skip: set[Path]) -> dict[str, dict]:
    """{page key: {"label", "of"}} for every page that looks like an earlier page of the folder (the
    first copy is kept) or a page already in data/raw/. `skip`: PDFs this desk wrote itself."""
    mine: list[tuple[str, list[int]]] = []
    out: dict[str, dict] = {}
    raw = raw_fingerprints(raw_pdfs(skip | {(folder / s.id).resolve() for s in sources}))
    for s in sources:
        for n in range(1, s.pages + 1):
            key = page_key(s.id, n)
            try:
                fp = fingerprints(load_page(folder, s.id, n, SMALL))
            except Exception:
                continue
            if fp is None:
                continue
            hit = next((k for k, other in mine if same(fp, other)), None)
            if hit:
                src, page = hit.rsplit("#", 1)
                out[key] = {"label": f'"{src}" page {page} in this folder', "of": hit}
            else:
                for rel, pages in raw.items():
                    i = next((i for i, other in enumerate(pages) if other and same(fp, other)), None)
                    if i is not None:
                        out[key] = {"label": f"{rel} page {i + 1}, already added", "of": f"{rel}#{i + 1}"}
                        break
            mine.append((key, fp))
    return out
