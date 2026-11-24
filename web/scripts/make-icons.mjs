// Draws favicon.ico (16, 32 and 48 px) and apple-icon.png (180 px) from src/app/icon.svg, so every icon
// is the same picture. Run it by hand after changing icon.svg: node scripts/make-icons.mjs (in web/).
// sharp comes with Next; the build does not run this script.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const app = new URL("../src/app/", import.meta.url);
const svg = readFileSync(new URL("icon.svg", app));
const TILE = "#13121a"; // the tile's colour in icon.svg (--surface)

// Drawn large, then scaled down, for smooth edges at small sizes.
const png = (size) => sharp(svg, { density: 72 * (size / 48) * 4 }).resize(size, size);

// favicon.ico: an ICO file holding one PNG per size (every browser reads PNGs inside an ICO).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((n) => png(n).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((n, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(n, at); // width
  header.writeUInt8(n, at + 1); // height
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
writeFileSync(new URL("favicon.ico", app), Buffer.concat([header, ...images]));

// apple-icon.png: a full square (iOS rounds the corners itself and would show the see-through ones black).
await png(180).flatten({ background: TILE }).png().toFile(fileURLToPath(new URL("apple-icon.png", app)));

console.log("Wrote src/app/favicon.ico and src/app/apple-icon.png");
