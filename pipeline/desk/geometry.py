"""Turn, split and black out one source page. Pure functions on Pillow images, no state.

Order, always: black out -> turn the page -> split -> turn the part.

Black-out boxes are stored as fractions (x0, y0, x1, y1) of the SOURCE page, before any turn, so a
box stays over the same name whatever turn or split is chosen later. The desk page draws them in the
upright view and converts with to_source(); the burn happens on the source pixels, so a box is part
of the image itself, never an overlay.

Turns are clockwise degrees (0, 90, 180, 270), the same convention as the manifest's `rotation`.
A split cuts the upright page in two: "h" into top and bottom, "v" into left and right, at a fraction
of the height (or width).
"""

import math

from PIL import Image, ImageDraw

TURNS = (0, 90, 180, 270)
SPLITS = ("", "h", "v")
Box = tuple[float, float, float, float]

# Image.transpose names rotations counter-clockwise; these are exact (no resampling).
_TRANSPOSE = {90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}


def turn_point(x: float, y: float, deg: int) -> tuple[float, float]:
    """A point (fractions of the image) after turning the image `deg` clockwise."""
    if deg == 90:
        return 1 - y, x
    if deg == 180:
        return 1 - x, 1 - y
    if deg == 270:
        return y, 1 - x
    return x, y


def turn_box(box: Box, deg: int) -> Box:
    """A box after turning the image `deg` clockwise."""
    (ax, ay), (bx, by) = turn_point(box[0], box[1], deg), turn_point(box[2], box[3], deg)
    return min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)


def to_upright(box: Box, rotation: int) -> Box:
    """Source-page box -> where it shows on the page turned by `rotation`."""
    return turn_box(box, rotation % 360)


def to_source(box: Box, rotation: int) -> Box:
    """Box drawn on the turned page -> source-page box (what the desk stores)."""
    return turn_box(box, (360 - rotation) % 360)


def part_region(split: str, at: float, part: int) -> Box:
    """The part of the upright page (fractions) that becomes output page `part` (0 = top / left)."""
    if split == "h":
        return (0.0, 0.0, 1.0, at) if part == 0 else (0.0, at, 1.0, 1.0)
    if split == "v":
        return (0.0, 0.0, at, 1.0) if part == 0 else (at, 0.0, 1.0, 1.0)
    return 0.0, 0.0, 1.0, 1.0


def box_pixels(box: Box, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Fractions -> pixel box (x0, y0, x1, y1), exclusive end, rounded outward so nothing peeks out."""
    w, h = size
    return (max(0, math.floor(box[0] * w)), max(0, math.floor(box[1] * h)),
            min(w, math.ceil(box[2] * w)), min(h, math.ceil(box[3] * h)))


def burn(img: Image.Image, boxes: list[Box]) -> Image.Image:
    """A copy of the image with every box filled black."""
    out = img.convert("RGB")  # always a copy
    draw = ImageDraw.Draw(out)
    for b in boxes:
        x0, y0, x1, y1 = box_pixels(b, out.size)
        if x1 > x0 and y1 > y0:
            draw.rectangle((x0, y0, x1 - 1, y1 - 1), fill=(0, 0, 0))  # Pillow's rectangle includes its end
    return out


def turn(img: Image.Image, deg: int) -> Image.Image:
    deg %= 360
    return img.transpose(_TRANSPOSE[deg]) if deg else img


def cut(img: Image.Image, split: str, at: float, part: int) -> Image.Image:
    """One part of an upright page. The cut is on a whole pixel, so the parts add up to the page."""
    if not split:
        return img
    w, h = img.size
    if split == "h":
        c = round(at * h)
        return img.crop((0, 0, w, c) if part == 0 else (0, c, w, h))
    c = round(at * w)
    return img.crop((0, 0, c, h) if part == 0 else (c, 0, w, h))


def render_part(img: Image.Image, boxes: list[Box], rotation: int, split: str, at: float, part: int, part_rotation: int = 0) -> Image.Image:
    """The output page for one part of a source page: black out, turn, split, turn the part."""
    return turn(cut(turn(burn(img, boxes), rotation), split, at, part), part_rotation)
