"use client";

import { useEffect, useRef } from "react";

import { PLANET, TREE } from "@/lib/colors";
import type { HeroCity } from "@/lib/home";
import { treeTopics } from "@/lib/season";

interface Props {
  cities: HeroCity[];
  onPick: (city: HeroCity) => void;
}

const SPIN = 0.22; // radians a second when left alone (the same on a 60 Hz and a 120 Hz screen)
const PITCH = 0.2; // the eye looks down on the tree a little
const EYE = 3.4; // how far the eye is, in tree heights (a mild perspective)
const BASE = 0.39; // how far the lowest branches reach, in tree heights
const LEVELS = 14; // shades of green, dark inside to lit tips
const FROSTS = 4; // shades of frost
const GROUPS = LEVELS + FROSTS;
const SLICES = 10; // depth slices, drawn back to front
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** A steady "random" number in 0..1 for the k-th thing, the same on every visit. */
const steady = (k: number) => {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** How far the branches reach at height y (tree units: 0 at the lowest branches' foot, 1 at the top). */
const reach = (y: number) => BASE * Math.pow(Math.max(0, 1 - y), 1.05);

const NEEDLE = 10; // numbers per needle: base x y z, tip x y z, the branch's way out (x, z), how far out it is, frost
const BRANCH = 4; // numbers per branch: its height on the trunk, its way out (x, z), its length
const SPINE = [0.06, 0.28, 0.5, 0.72, 0.92]; // where along a branch its line is drawn (0 trunk, 1 tip)
const GROUND = -0.03; // the snow the tree stands in

/** The presents under the tree, round the trunk: where (angle, distance from the trunk), turned how far,
 *  how wide, deep and tall (tree units), and which wrapping (TREE.presents). */
const PRESENTS = [
  { az: 0.25, r: 0.13, yaw: 0.3, w: 0.11, d: 0.09, h: 0.1, k: 0 },
  { az: 1.15, r: 0.145, yaw: -0.4, w: 0.08, d: 0.08, h: 0.075, k: 1 },
  { az: 2.0, r: 0.12, yaw: 0.9, w: 0.085, d: 0.07, h: 0.12, k: 2 },
  { az: 2.95, r: 0.15, yaw: 0.2, w: 0.12, d: 0.09, h: 0.075, k: 3 },
  { az: 3.85, r: 0.125, yaw: -0.7, w: 0.075, d: 0.075, h: 0.095, k: 4 },
  { az: 4.75, r: 0.14, yaw: 0.5, w: 0.1, d: 0.085, h: 0.105, k: 5 },
  { az: 5.6, r: 0.125, yaw: -0.2, w: 0.08, d: 0.07, h: 0.075, k: 6 },
  { az: 0.75, r: 0.25, yaw: 0.6, w: 0.065, d: 0.06, h: 0.06, k: 2 },
  { az: 3.5, r: 0.26, yaw: -0.5, w: 0.07, d: 0.055, h: 0.055, k: 0 },
];
const RIBBON = 0.0075; // half a ribbon's width, tree units

/**
 * The tree, once: tiers of branches round the trunk (more and longer ones low down), each rising a little
 * off the trunk and then drooping, with side twigs of needles along it, and a leader at the top. Every
 * needle is a short stroke; each branch also keeps its line, along which the tree is filled in dark green
 * behind its needles, so it looks dense. Deterministic: the same tree on every visit.
 */
function grow(): { needles: Float32Array; branches: Float32Array } {
  const out: number[] = [];
  const arms: number[] = [];
  let seed = 0;
  const rnd = () => steady(++seed);
  const needle = (bx: number, by: number, bz: number, dx: number, dy: number, dz: number, len: number, ca: number, sa: number, frac: number, frost: boolean) => {
    const n = Math.hypot(dx, dy, dz) || 1;
    out.push(bx, by, bz, bx + (dx / n) * len, by + (dy / n) * len, bz + (dz / n) * len, ca, sa, frac, frost ? 1 : 0);
  };
  const TIERS = 19;
  for (let k = 0; k < TIERS; k++) {
    const t = k / (TIERS - 1);
    const yb = 0.08 + 0.84 * Math.pow(t, 0.92);
    const n = Math.max(4, Math.round(5 + 9 * (1 - t)));
    for (let j = 0; j < n; j++) {
      const az = (j / n) * TAU + k * GOLDEN + (rnd() - 0.5) * 0.5;
      const ca = Math.cos(az);
      const sa = Math.sin(az);
      const L = reach(yb) * (0.82 + 0.3 * rnd()) + 0.02;
      arms.push(yb, ca, sa, L);
      const samples = Math.round(5 + (28 * L) / BASE);
      for (let i = 0; i < samples; i++) {
        const s = 0.12 + (0.88 * (i + rnd() * 0.8)) / samples;
        const r = L * s;
        const y = yb + L * (0.1 * s - 0.32 * s * s); // up a little off the trunk, then drooping
        const slope = 0.1 - 0.64 * s;
        for (let m = 0; m < 4; m++) {
          // a side twig around the branch, mostly to the sides
          const psi = rnd() * TAU;
          const off = L * 0.11 * (1 - 0.55 * s) * (0.35 + 0.65 * rnd());
          const sx = -sa * Math.cos(psi);
          const sy = Math.sin(psi) * 0.6;
          const sz = ca * Math.cos(psi);
          const bx = ca * r + sx * off;
          const by = y + sy * off;
          const bz = sa * r + sz * off;
          // its needle: out along the branch, splayed to the side, a little up
          const dy = slope * 0.55 + 0.25 + (rnd() - 0.5) * 0.3;
          const frac = Math.min(1.1, r / Math.max(0.02, reach(yb)));
          needle(bx, by, bz, ca * 0.55 + sx * 0.75, dy, sa * 0.55 + sz * 0.75, 0.013 + 0.011 * rnd(), ca, sa, frac, frac > 0.8 && dy > 0.05 && rnd() < 0.06);
        }
      }
    }
  }
  // the leader: the trunk's tip above the last tier
  for (let i = 0; i < 70; i++) {
    const y = 0.9 + (0.1 * i) / 70;
    const az = i * GOLDEN * 2;
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    const off = 0.022 * (1 - (y - 0.9) / 0.1) * rnd();
    needle(ca * off, y, sa * off, ca, 0.6, sa, 0.016 + 0.01 * rnd(), ca, sa, 0.9, false);
  }
  return { needles: new Float32Array(out), branches: new Float32Array(arms) };
}

/** "#rrggbb" and a mix of two of them. */
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const p = rgbOf(a);
  const q = rgbOf(b);
  return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(",")})`;
};
/** The needle shades: dark inside the tree, through mid green, to the lit tips; then the frost. */
const SHADES = [
  ...Array.from({ length: LEVELS }, (_, l) => {
    const t = l / (LEVELS - 1);
    return t < 0.55 ? mix(TREE.needleDark, TREE.needleMid, t / 0.55) : mix(TREE.needleMid, TREE.needleLit, (t - 0.55) / 0.45);
  }),
  ...Array.from({ length: FROSTS }, (_, l) => mix(TREE.frostShade, TREE.frostLit, l / (FROSTS - 1))),
];

/** A small picture drawn once and stamped many times. */
function sprite(size: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!);
  return c;
}
/** A fairy light's glow: a white-hot middle fading out through its colour. */
const glowSprite = (rgb: string) =>
  sprite(64, (g) => {
    const b = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    b.addColorStop(0, `rgba(${TREE.shine},1)`);
    b.addColorStop(0.1, `rgba(${rgb},.95)`);
    b.addColorStop(0.32, `rgba(${rgb},.28)`);
    b.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = b;
    g.fillRect(0, 0, 64, 64);
  });
/** A glass bauble (the ball's centre at 32,36, radius 20): its colour, darker to the rim, a window of light
 *  on the upper left and a warm glint of the fairy lights low on the right, with a silver cap and loop. */
const baubleSprite = (col: string) =>
  sprite(64, (g) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(32, 36, 20, 0, TAU);
    g.fill();
    const dk = g.createRadialGradient(26, 30, 3, 32, 36, 21);
    dk.addColorStop(0, `rgba(${TREE.depth},0)`);
    dk.addColorStop(0.75, `rgba(${TREE.depth},.25)`);
    dk.addColorStop(1, `rgba(${TREE.depth},.6)`);
    g.fillStyle = dk;
    g.beginPath();
    g.arc(32, 36, 20, 0, TAU);
    g.fill();
    const hi = g.createRadialGradient(24, 28, 0, 24, 28, 9);
    hi.addColorStop(0, `rgba(${TREE.shine},.95)`);
    hi.addColorStop(1, `rgba(${TREE.shine},0)`);
    g.fillStyle = hi;
    g.beginPath();
    g.arc(24, 28, 9, 0, TAU);
    g.fill();
    g.fillStyle = `rgba(${TREE.lightWarm},.75)`;
    g.beginPath();
    g.arc(40, 45, 2, 0, TAU);
    g.fill();
    const cap = g.createLinearGradient(27, 0, 37, 0);
    cap.addColorStop(0, TREE.capShade);
    cap.addColorStop(0.45, TREE.cap);
    cap.addColorStop(1, TREE.capShade);
    g.fillStyle = cap;
    g.fillRect(27, 12, 10, 6);
    g.strokeStyle = TREE.loop;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(32, 9, 3, 0, TAU);
    g.stroke();
  });

/**
 * The winter look's hero (lib/season.ts): a Christmas tree that turns slowly, lit from the upper left,
 * with fairy lights twinkling up a spiral and a star on top. Its baubles are the most asked topics on the
 * site: hover one to read it, click it to open its questions. Drag to turn the tree. The lights come on
 * from the bottom up when the page opens; under reduced motion it stands still and does not twinkle. It
 * stops drawing while it is off screen.
 */
export default function ChristmasTree({ cities, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";

    const { needles, branches } = grow();
    const count = needles.length / NEEDLE;
    const screen = new Float32Array(count * 4); // each needle's two ends on screen
    const keys = new Uint16Array(count); // depth slice and shade
    const order = new Uint32Array(count);
    const starts = new Uint32Array(SLICES * GROUPS + 1);
    const arms = branches.length / BRANCH;
    const armAt = new Float32Array(arms * 12); // each branch's line on screen (5 points), its inner and outer width
    const armShade = new Uint8Array(arms);
    // the star's ten facets, each lit by how it faces the light (upper left)
    const facets = Array.from({ length: 10 }, (_, k) => {
      const tip = -Math.PI / 2 + Math.floor(k / 2) * ((2 * Math.PI) / 5);
      const side = k % 2 ? 1 : -1;
      const facing = tip + (side * Math.PI) / 10;
      return { tip, side, color: mix(TREE.starShade, TREE.starCore, 0.5 + 0.5 * Math.cos(facing + (3 * Math.PI) / 4)) };
    });
    const wraps = TREE.presents.map(([paper, ribbon]) => [rgbOf(paper), rgbOf(ribbon)]);

    // fairy lights: most on a spiral round the tree, the rest scattered over it
    const lights = Array.from({ length: 130 }, (_, i) => {
      const spiral = i < 90;
      const t = spiral ? (i + 0.5) / 90 : steady(i + 300);
      const y = 0.1 + 0.8 * t;
      const az = spiral ? t * 6.5 * TAU + (steady(i + 200) - 0.5) * 0.25 : steady(i + 400) * TAU;
      const r = reach(y) * (spiral ? 0.92 : 0.6 + 0.35 * steady(i + 500));
      return { x: r * Math.cos(az), y, z: r * Math.sin(az), t, amber: steady(i + 600) < 0.3, ph: steady(i + 700) * TAU, sp: 1.3 + steady(i + 800) * 2.4 };
    });
    // the baubles: the most asked topics, high to low round the tree, at the branch tips
    const picked = treeTopics(cities);
    const baubles = picked.map((c, k) => {
      const y = 0.7 - (0.5 * k) / Math.max(1, picked.length - 1);
      const az = k * 2.4 + 0.6;
      const r = reach(y) * 0.86;
      return { c, x: r * Math.cos(az), y: y - 0.015, z: r * Math.sin(az) };
    });
    cv.setAttribute(
      "aria-label",
      `A Christmas tree. Its ${baubles.length} baubles are the most asked topics on the site; click one to open its questions.`,
    );
    const glow = { warm: glowSprite(TREE.lightWarm), amber: glowSprite(TREE.lightAmber) };
    const baublePics = TREE.baubles.map(baubleSprite);

    const lift = new Float32Array(baubles.length); // 0..1: how far each bauble has grown under the pointer
    let W = 0;
    let D = 1;
    let rot = 0.4;
    let vel = reduced ? 0 : SPIN;
    let hov = -1;
    let drag: { x: number; t: number; m: number; v: number } | null = null;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    const born = last;
    let shown: { i: number; x: number; y: number; z: number; r: number }[] = []; // the baubles on screen now
    // Drawing every needle is the costly part: a small tree draws every other one, and if frames still
    // come slowly (a slow phone), it draws fewer, down to one in three.
    let thin = 1;
    let slow = 17; // how slow frames have been lately, in ms (an average that forgets)
    let since = 0; // when thin last changed
    let regained = 0; // how many times it has drawn more again
    let backdrop: HTMLCanvasElement | null = null; // the halo and the snow, painted once for each size

    const size = () => {
      const r = cv.getBoundingClientRect();
      D = Math.min(devicePixelRatio || 1, 1.5);
      W = r.width;
      cv.width = r.width * D;
      cv.height = r.height * D;
      cx.setTransform(D, 0, 0, D, 0, 0);
      backdrop = null;
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();

    // turn by rot round the trunk, tip towards the eye by PITCH, then a mild perspective
    let cosT = 1;
    let sinT = 0;
    const cosP = Math.cos(PITCH);
    const sinP = Math.sin(PITCH);
    let S = 0;
    let midX = 0;
    let midY = 0;
    let px = 0;
    let py = 0;
    let f = 1;
    let qx = 0; // the point as the eye sees it (across, up), before the perspective
    let qy = 0;
    /** Puts (x, y, z) on screen in px, py; returns its depth (towards the eye) and sets the scale in f. */
    const project = (x: number, y: number, z: number) => {
      const xr = x * cosT - z * sinT;
      const zr = x * sinT + z * cosT;
      const yv = y * cosP - zr * sinP;
      const zv = zr * cosP + y * sinP;
      f = EYE / (EYE - zv);
      qx = xr;
      qy = yv;
      px = midX + xr * S * f;
      py = midY - (yv - 0.5 * cosP) * S * f;
      return zv;
    };
    const sliceOf = (zv: number) => Math.max(0, Math.min(SLICES - 1, Math.floor(((zv + BASE * 1.05 - 0.1 * sinP) / (BASE * 2.1 + 0.2 * sinP)) * SLICES)));
    // the light comes from the upper left, in front
    const lx = -0.5;
    const ly = 0.55;
    const lz = 0.67;
    let sc = 1; // the canvas's size against a 560px one, for line widths and sprites

    /** How lit a flat face is, from its outward normal (x, y, z): 0.42 facing away to 1.1 facing the light. */
    const lightOn = (nx: number, ny: number, nz: number) => 0.42 + 0.68 * Math.max(0, (nx * cosT - nz * sinT) * lx + ny * ly + (nx * sinT + nz * cosT) * lz);
    /** Whether a face at p with outward normal (x, y, z) turns towards the eye. */
    const facesEye = (p: number[], nx: number, ny: number, nz: number) => {
      const zc = project(p[0], p[1], p[2]);
      const xr = nx * cosT - nz * sinT;
      const zr = nx * sinT + nz * cosT;
      return xr * -qx + (ny * cosP - zr * sinP) * (0.5 * cosP - qy) + (zr * cosP + ny * sinP) * (EYE - zc) > 0;
    };
    /** A closed path through these points, on screen. */
    const poly = (pts: number[][]) => {
      cx.beginPath();
      pts.forEach(([x, y, z], i) => {
        project(x, y, z);
        if (i) cx.lineTo(px, py);
        else cx.moveTo(px, py);
      });
      cx.closePath();
    };
    const tint = (c: number[], b: number) => `rgb(${c.map((v) => Math.min(255, Math.round(v * b))).join(",")})`;

    /** A branch's line as a band round its 5 points on screen, wider over its inner half, with round ends,
     *  added to the path being built. */
    const along = new Float32Array(10); // the band's direction on screen at each point
    const armBand = (o: number) => {
      let ux = 0;
      let uy = -1; // a branch pointing at the eye has no direction on screen: its band stands upright
      for (let i = 0; i < 5; i++) {
        const a = o + Math.max(0, i - 1) * 2;
        const b = o + Math.min(4, i + 1) * 2;
        const dx = armAt[b] - armAt[a];
        const dy = armAt[b + 1] - armAt[a + 1];
        const l = Math.hypot(dx, dy);
        if (l > 0.01) {
          ux = dx / l;
          uy = dy / l;
        }
        along[i * 2] = ux;
        along[i * 2 + 1] = uy;
      }
      const inner = armAt[o + 10] / 2;
      const outer = armAt[o + 11] / 2;
      for (let i = 0; i < 5; i++) {
        const h = i < 3 ? inner : outer;
        const x = armAt[o + i * 2] - along[i * 2 + 1] * h;
        const y = armAt[o + i * 2 + 1] + along[i * 2] * h;
        if (i) cx.lineTo(x, y);
        else cx.moveTo(x, y);
      }
      const tip = Math.atan2(along[9], along[8]);
      cx.arc(armAt[o + 8], armAt[o + 9], outer, tip + Math.PI / 2, tip - Math.PI / 2, true);
      for (let i = 4; i >= 0; i--) {
        const h = i < 3 ? inner : outer;
        cx.lineTo(armAt[o + i * 2] + along[i * 2 + 1] * h, armAt[o + i * 2 + 1] - along[i * 2] * h);
      }
      const foot = Math.atan2(along[1], along[0]);
      cx.arc(armAt[o], armAt[o + 1], inner, foot - Math.PI / 2, foot - (3 * Math.PI) / 2, true);
      cx.closePath();
    };

    /** The violet halo behind the tree, as behind the planet, and the snow it stands in with its shadow. They
     *  do not turn, so they are painted once for each size of the canvas and stamped on every frame. */
    const paintBackdrop = () => {
      const c = document.createElement("canvas");
      c.width = cv.width;
      c.height = cv.height;
      const g = c.getContext("2d")!;
      g.setTransform(D, 0, 0, D, 0, 0);
      const h = g.createRadialGradient(midX, midY, 0, midX, midY, W * 0.5);
      h.addColorStop(0, `rgba(${PLANET.halo},.22)`);
      h.addColorStop(1, `rgba(${PLANET.halo},0)`);
      g.fillStyle = h;
      g.fillRect(0, 0, W, W);
      project(0, GROUND, 0);
      const rx = BASE * 1.45 * S;
      g.translate(px, py);
      g.scale(1, sinP * 1.4);
      const snow = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      snow.addColorStop(0, `rgba(${TREE.snow},.5)`);
      snow.addColorStop(0.6, `rgba(${TREE.snow},.18)`);
      snow.addColorStop(1, `rgba(${TREE.snow},0)`);
      g.fillStyle = snow;
      g.beginPath();
      g.arc(0, 0, rx, 0, TAU);
      g.fill();
      const shade = g.createRadialGradient(0, 0, 0, 0, 0, rx * 0.6);
      shade.addColorStop(0, `rgba(${TREE.shadow},.55)`);
      shade.addColorStop(1, `rgba(${TREE.shadow},0)`);
      g.fillStyle = shade;
      g.beginPath();
      g.arc(0, 0, rx * 0.6, 0, TAU);
      g.fill();
      return c;
    };

    /** A wrapped present: its shadow on the snow, the faces that turn to the eye with a ribbon round each,
     *  and a bow on top. It turns with the tree. */
    const drawPresent = (p: (typeof PRESENTS)[number]) => {
      const cy = Math.cos(p.yaw);
      const sy = Math.sin(p.yaw);
      const ox = Math.cos(p.az) * p.r;
      const oz = Math.sin(p.az) * p.r;
      // a point on the box: a across its width, b across its depth (both -1..1), up from the snow
      const at = (a: number, b: number, up: number) => [ox + (a * cy * p.w) / 2 - (b * sy * p.d) / 2, GROUND + up, oz + (a * sy * p.w) / 2 + (b * cy * p.d) / 2];
      const [paper, ribbon] = wraps[p.k % wraps.length];
      const ra = RIBBON / (p.w / 2);
      const rb = RIBBON / (p.d / 2);
      cx.fillStyle = `rgba(${TREE.shadow},.5)`;
      poly([at(-1.2, -1.2, 0), at(1.2, -1.2, 0), at(1.2, 1.2, 0), at(-1.2, 1.2, 0)]);
      cx.fill();
      for (const [across, sign] of [
        [true, 1],
        [true, -1],
        [false, 1],
        [false, -1],
      ] as const) {
        // the two sides across the width (the ribbon runs down them across the depth), then the other two
        const nx = across ? sign * cy : -sign * sy;
        const nz = across ? sign * sy : sign * cy;
        const side = (q: number, up: number) => (across ? at(sign, q, up) : at(q, sign, up));
        if (!facesEye(side(0, p.h / 2), nx, 0, nz)) continue;
        const lit = lightOn(nx, 0, nz);
        const band = across ? rb : ra;
        cx.fillStyle = tint(paper, lit);
        poly([side(-1, 0), side(1, 0), side(1, p.h), side(-1, p.h)]);
        cx.fill();
        cx.fillStyle = tint(ribbon, lit);
        poly([side(-band, 0), side(band, 0), side(band, p.h), side(-band, p.h)]);
        cx.fill();
      }
      const top = lightOn(0, 1, 0);
      cx.fillStyle = tint(paper, top);
      poly([at(-1, -1, p.h), at(1, -1, p.h), at(1, 1, p.h), at(-1, 1, p.h)]);
      cx.fill();
      cx.strokeStyle = `rgba(${TREE.shine},.16)`;
      cx.lineWidth = 0.8;
      cx.stroke();
      cx.fillStyle = tint(ribbon, top);
      poly([at(-1, -rb, p.h), at(1, -rb, p.h), at(1, rb, p.h), at(-1, rb, p.h)]);
      cx.fill();
      poly([at(-ra, -1, p.h), at(ra, -1, p.h), at(ra, 1, p.h), at(-ra, 1, p.h)]);
      cx.fill();
      // the bow: two loops and a knot
      project(ox, GROUND + p.h, oz);
      const s = Math.min(p.w, p.d) * 0.3 * S * f;
      for (const side of [-1, 1]) {
        cx.fillStyle = tint(ribbon, top * 1.05);
        cx.beginPath();
        cx.ellipse(px + side * s * 0.62, py - s * 0.32, s * 0.68, s * 0.4, side * -0.45, 0, TAU);
        cx.fill();
        cx.fillStyle = tint(ribbon, top * 0.55);
        cx.beginPath();
        cx.ellipse(px + side * s * 0.66, py - s * 0.32, s * 0.36, s * 0.17, side * -0.45, 0, TAU);
        cx.fill();
      }
      cx.fillStyle = tint(ribbon, top * 1.15);
      cx.beginPath();
      cx.arc(px, py - s * 0.28, s * 0.24, 0, TAU);
      cx.fill();
    };

    /** The dark inside of the tree: a cone about two thirds as wide as the branches reach, round the trunk. Being round,
     *  it looks the same from every side: its outline is drawn where the eye sees its edges. */
    const drawCore = () => {
      const pts: number[][] = [];
      const at = (across: number, y: number, toward: number) => [across * cosT + toward * sinT, y, -across * sinT + toward * cosT];
      const r = (y: number) => reach(y) * 0.62;
      for (let i = 0; i <= 12; i++) {
        const y = 0.12 + (0.84 * i) / 12;
        pts.push(at(-r(y), y, 0));
      }
      for (let i = 12; i >= 0; i--) {
        const y = 0.12 + (0.84 * i) / 12;
        pts.push(at(r(y), y, 0));
      }
      for (let i = 1; i < 12; i++) {
        const a = (Math.PI * i) / 12;
        pts.push(at(r(0.12) * Math.cos(a), 0.12, r(0.12) * Math.sin(a)));
      }
      const shade = cx.createLinearGradient(midX - r(0.12) * S, 0, midX + r(0.12) * S, 0);
      shade.addColorStop(0, TREE.needleDark);
      shade.addColorStop(0.35, mix(TREE.needleDark, TREE.needleMid, 0.4));
      shade.addColorStop(1, TREE.needleDark);
      cx.fillStyle = shade;
      poly(pts);
      cx.fill();
    };

    /** The trunk: wider at the foot with a flare of roots, darker on the side away from the light, with
     *  furrows in its bark that turn with the tree. */
    const drawTrunk = () => {
      project(0, GROUND, 0);
      const bx = px;
      const by = py;
      const w0 = 0.034 * S * f;
      const flare = 0.058 * S * f;
      const rise = 0.04 * S;
      project(0, 0.32, 0);
      const tx = px;
      const ty = py;
      const w1 = 0.015 * S * f;
      const bark = cx.createLinearGradient(bx - w0, 0, bx + w0, 0);
      bark.addColorStop(0, TREE.trunkDark);
      bark.addColorStop(0.3, TREE.trunkLit);
      bark.addColorStop(0.65, mix(TREE.trunkLit, TREE.trunkDark, 0.55));
      bark.addColorStop(1, TREE.trunkDark);
      cx.fillStyle = bark;
      cx.beginPath();
      cx.moveTo(bx - flare, by);
      cx.quadraticCurveTo(bx - w0, by - rise * 0.15, bx - w0, by - rise);
      cx.lineTo(tx - w1, ty);
      cx.lineTo(tx + w1, ty);
      cx.lineTo(bx + w0, by - rise);
      cx.quadraticCurveTo(bx + w0, by - rise * 0.15, bx + flare, by);
      cx.closePath();
      cx.fill();
      cx.lineWidth = Math.max(0.8, 1.1 * sc);
      for (let k = 0; k < 9; k++) {
        const a = k * 0.7 + steady(k + 900) * 0.4 + rot;
        const toward = Math.sin(a);
        if (toward < 0.1) continue;
        cx.strokeStyle = `rgba(${TREE.depth},${(0.45 * toward).toFixed(3)})`;
        cx.beginPath();
        cx.moveTo(bx + Math.cos(a) * w0 * 0.92, by - rise * 0.4);
        cx.lineTo(tx + Math.cos(a) * w1 * 0.9, ty);
        cx.stroke();
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!drag) {
        vel += ((reduced ? 0 : SPIN) - vel) * Math.min(1, dt * 2.2);
        rot += vel * dt;
      }
      cosT = Math.cos(rot);
      sinT = Math.sin(rot);
      S = W * 0.74;
      midX = W / 2;
      midY = W * 0.5;
      sc = Math.max(0.6, W / 560);
      const age = now - born;
      cx.clearRect(0, 0, W, W);
      backdrop ??= paintBackdrop();
      cx.drawImage(backdrop, 0, 0, W, W);

      // every needle on screen, with its depth slice and shade; then sorted by both (a counting sort)
      if (age > 3000 && dt > 0) {
        slow += (dt * 1000 - slow) * 0.05;
        if (slow > 26 && thin < 3) {
          thin++;
          slow = 17;
          since = now;
        } else if (slow < 19 && thin > 1 && regained < 2 && now - since > 5000) {
          // fast again for 5 s (a slow start, another tab busy): draw more again, at most twice so it settles
          thin--;
          regained++;
          slow = 17;
          since = now;
        }
      }
      const step = (W < 420 ? 2 : 1) * thin;
      starts.fill(0);
      for (let n = 0; n < count; n += step) {
        const o = n * NEEDLE;
        const z0 = project(needles[o], needles[o + 1], needles[o + 2]);
        screen[n * 4] = px;
        screen[n * 4 + 1] = py;
        project(needles[o + 3], needles[o + 4], needles[o + 5]);
        screen[n * 4 + 2] = px;
        screen[n * 4 + 3] = py;
        // lit by how the branch faces the light, darker deep inside the tree and on its far side
        const ca = needles[o + 6];
        const sa = needles[o + 7];
        const nx = ca * cosT - sa * sinT;
        const nz = ca * sinT + sa * cosT;
        const diffuse = Math.max(0, (nx * lx + 0.45 * ly + nz * lz) / 1.0966);
        const depth = clamp01((z0 + BASE) / (2 * BASE));
        const lit = (0.16 + 0.84 * diffuse) * (0.28 + 0.72 * Math.min(1, needles[o + 8])) * (0.55 + 0.45 * depth);
        // (a little brighter than the light alone says: one pixel wide, a needle shows less of its colour)
        const g = needles[o + 9] ? LEVELS + Math.min(FROSTS - 1, Math.floor(lit * 1.6 * FROSTS)) : Math.min(LEVELS - 1, Math.floor(lit * 1.5 * LEVELS));
        const key = sliceOf(z0) * GROUPS + g;
        keys[n] = key;
        starts[key + 1]++;
      }
      for (let k = 0; k < SLICES * GROUPS; k++) starts[k + 1] += starts[k];
      const fill = starts.slice(0, SLICES * GROUPS);
      for (let n = 0; n < count; n += step) order[fill[keys[n]]++] = n;

      // lights and baubles, each in its depth slice
      const lightsIn: number[][] = Array.from({ length: SLICES }, () => []);
      const lightAt = new Float32Array(lights.length * 4);
      lights.forEach((l, i) => {
        const z = project(l.x, l.y, l.z);
        lightAt[i * 4] = px;
        lightAt[i * 4 + 1] = py;
        lightAt[i * 4 + 2] = f;
        lightAt[i * 4 + 3] = z;
        lightsIn[sliceOf(z)].push(i);
      });
      const baublesIn: number[][] = Array.from({ length: SLICES }, () => []);
      shown = baubles.map((b, i) => {
        const z = project(b.x, b.y, b.z);
        baublesIn[sliceOf(z)].push(i);
        lift[i] += ((i === hov ? 1 : 0) - lift[i]) * Math.min(1, dt * 14);
        return { i, x: px, y: py, z, r: 0.024 * S * f * (1 + 0.25 * lift[i]) };
      });

      // each branch's line, to fill the tree in behind its needles: the deep green of the shade inside a tree
      const armsIn: number[][] = Array.from({ length: SLICES }, () => []);
      for (let a = 0; a < arms; a++) {
        const yb = branches[a * BRANCH];
        const ca = branches[a * BRANCH + 1];
        const sa = branches[a * BRANCH + 2];
        const L = branches[a * BRANCH + 3];
        let zMid = 0;
        let fMid = 1;
        for (let i = 0; i < SPINE.length; i++) {
          const s = SPINE[i];
          const z = project(ca * L * s, yb + L * (0.1 * s - 0.32 * s * s), sa * L * s);
          armAt[a * 12 + i * 2] = px;
          armAt[a * 12 + i * 2 + 1] = py;
          if (i === 2) {
            zMid = z;
            fMid = f;
          }
        }
        const spread = L * 0.115 * S * fMid; // about half the way its twigs reach out round it
        armAt[a * 12 + 10] = spread * 0.84;
        armAt[a * 12 + 11] = spread * 0.58;
        const nx = ca * cosT - sa * sinT;
        const nz = ca * sinT + sa * cosT;
        const diffuse = Math.max(0, (nx * lx + 0.45 * ly + nz * lz) / 1.0966);
        const lit = (0.16 + 0.84 * diffuse) * 0.2 * (0.55 + 0.45 * clamp01((zMid + BASE) / (2 * BASE)));
        armShade[a] = Math.min(LEVELS - 1, Math.floor(lit * 1.25 * LEVELS));
        armsIn[sliceOf(zMid)].push(a);
      }
      // the trunk (-1), the tree's dark core round it (-2) and the presents, each in its depth slice, far
      // ones first
      const solidsIn: { z: number; k: number }[][] = Array.from({ length: SLICES }, () => []);
      const tz = project(0, 0.05, 0);
      solidsIn[sliceOf(tz)].push({ z: tz, k: -1 }, { z: tz + 1e-4, k: -2 });
      PRESENTS.forEach((p, k) => {
        const z = project(Math.cos(p.az) * p.r, GROUND + p.h / 2, Math.sin(p.az) * p.r);
        solidsIn[sliceOf(z)].push({ z, k });
      });

      // Needles are one pixel of the canvas wide: the browser draws lines that thin as hairlines, many
      // times faster than any wider line (on a laptop's GPU, 16,000 needles run at about 60 frames a second
      // against 10 at 1.6 pixels).
      const needleWidth = 1 / D;
      cx.lineCap = "round";
      cx.lineJoin = "round";
      for (let s = 0; s < SLICES; s++) {
        for (const { k } of solidsIn[s].sort((a, b) => a.z - b.z)) {
          if (k === -1) drawTrunk();
          else if (k === -2) drawCore();
          else drawPresent(PRESENTS[k]);
        }
        // the branches' bands, all of one shade filled in one go (far cheaper than a wide line for each)
        const inSlice = armsIn[s].sort((a, b) => armShade[a] - armShade[b]);
        for (let j = 0; j < inSlice.length; ) {
          const shade = armShade[inSlice[j]];
          cx.fillStyle = SHADES[shade];
          cx.beginPath();
          for (; j < inSlice.length && armShade[inSlice[j]] === shade; j++) armBand(inSlice[j] * 12);
          cx.fill();
        }
        cx.lineWidth = needleWidth;
        for (let g = 0; g < GROUPS; g++) {
          const k = s * GROUPS + g;
          if (starts[k] === starts[k + 1]) continue;
          cx.strokeStyle = SHADES[g];
          cx.beginPath();
          for (let j = starts[k]; j < starts[k + 1]; j++) {
            const n = order[j] * 4;
            cx.moveTo(screen[n], screen[n + 1]);
            cx.lineTo(screen[n + 2], screen[n + 3]);
          }
          cx.stroke();
        }
        // the lights glow (added light), coming on from the bottom up when the page opens
        if (lightsIn[s].length) {
          cx.globalCompositeOperation = "lighter";
          for (const i of lightsIn[s]) {
            const l = lights[i];
            const on = reduced ? 1 : clamp01((age - 400 - l.t * 1400) / 260);
            if (!on) continue;
            const twinkle = reduced ? 0.85 : 0.62 + 0.38 * Math.sin((now / 1000) * l.sp + l.ph);
            const behind = lightAt[i * 4 + 3] < 0 ? 0.55 : 1;
            const g = 15 * sc * lightAt[i * 4 + 2];
            cx.globalAlpha = on * twinkle * behind;
            cx.drawImage(l.amber ? glow.amber : glow.warm, lightAt[i * 4] - g / 2, lightAt[i * 4 + 1] - g / 2, g, g);
          }
          cx.globalAlpha = 1;
          cx.globalCompositeOperation = "source-over";
        }
        for (const i of baublesIn[s]) {
          const b = shown[i];
          const pop = reduced ? 1 : easeOut(clamp01((age - 1300 - i * 90) / 500));
          if (pop < 0.02) continue;
          const r = b.r * pop;
          const sz = (64 * r) / 20; // the ball is 20 of the sprite's 64
          cx.drawImage(baublePics[i % baublePics.length], b.x - sz / 2, b.y - (sz * 36) / 64, sz, sz);
        }
      }

      // the star on top of the trunk's line, upright and facing the eye, in a soft glow that breathes; its
      // five points are each two facets, lit or in shade by how they face the light
      project(0, 1.035, 0);
      const flare = reduced ? 1 : easeOut(clamp01((age - 1600) / 700));
      if (flare > 0) {
        const pulse = reduced ? 1 : 0.9 + 0.1 * Math.sin(now / 700);
        const R = 15 * sc * f * flare;
        cx.globalCompositeOperation = "lighter";
        const sg = cx.createRadialGradient(px, py, 0, px, py, R * 3.2);
        sg.addColorStop(0, `rgba(${TREE.starGlow},${(0.55 * pulse).toFixed(3)})`);
        sg.addColorStop(1, `rgba(${TREE.starGlow},0)`);
        cx.fillStyle = sg;
        cx.fillRect(px - R * 3.2, py - R * 3.2, R * 6.4, R * 6.4);
        cx.globalCompositeOperation = "source-over";
        for (const { tip, side, color } of facets) {
          const inner = tip + (side * Math.PI) / 5;
          cx.fillStyle = color;
          cx.beginPath();
          cx.moveTo(px, py);
          cx.lineTo(px + Math.cos(tip) * R, py + Math.sin(tip) * R);
          cx.lineTo(px + Math.cos(inner) * R * 0.42, py + Math.sin(inner) * R * 0.42);
          cx.closePath();
          cx.fill();
        }
      }

      // the label of the bauble under the pointer, last, on a pill kept inside the canvas
      const hb = shown[hov];
      if (hb && hb.z > -0.05) {
        const text = baubles[hov].c.name;
        cx.font = `500 12px ${monoFamily}, monospace`;
        const w = cx.measureText(text).width;
        const x = Math.max(8, Math.min(hb.x + hb.r + 8, W - w - 8));
        const y = Math.max(18, hb.y - hb.r - 6);
        cx.fillStyle = TREE.label;
        cx.strokeStyle = `rgba(${TREE.lightWarm},.35)`;
        cx.lineWidth = 1;
        cx.beginPath();
        cx.roundRect(x - 7, y - 14, w + 14, 21, 10.5);
        cx.fill();
        cx.stroke();
        cx.fillStyle = TREE.labelInk;
        cx.fillText(text, x, y);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    /** The bauble under the pointer (on the near side of the tree), or -1. */
    const hit = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = -1;
      let bd = Infinity;
      for (const b of shown) {
        if (b.z < -0.05) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < Math.max(14, b.r + 6) && d < bd) {
          bd = d;
          best = b.i;
        }
      }
      return best;
    };
    const cursor = () => (cv.style.cursor = drag ? "grabbing" : hov >= 0 ? "pointer" : "grab");
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, t: e.timeStamp, m: 0, v: 0 };
      cv.setPointerCapture(e.pointerId);
      cursor();
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const d = e.clientX - drag.x;
        drag.m += Math.abs(d);
        // the side facing you follows the pointer, as if you had hold of it (turning rot the other way)
        rot -= d * 0.008;
        drag.v = (-d * 0.008) / Math.max(0.008, (e.timeStamp - drag.t) / 1000);
        drag.x = e.clientX;
        drag.t = e.timeStamp;
      } else hov = hit(e);
      cursor();
    };
    const up = (e: PointerEvent) => {
      if (drag && drag.m < 6) {
        const i = hit(e);
        if (i >= 0) pickRef.current(baubles[i].c);
      }
      // let go while still moving: the tree keeps that turn for a moment
      if (drag && drag.m >= 6 && e.timeStamp - drag.t < 80 && !reduced) vel = Math.max(-5, Math.min(5, drag.v));
      drag = null;
      cursor();
    };
    const cancel = () => {
      drag = null;
      cursor();
    };
    const leave = () => {
      hov = -1;
      cursor();
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", cancel);
    cv.addEventListener("pointerleave", leave);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(cv);
    cursor();
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", cancel);
      cv.removeEventListener("pointerleave", leave);
    };
  }, [cities]);

  return (
    <div className="hero-planet">
      <canvas ref={ref} aria-label="A Christmas tree. Its baubles are the most asked topics on the site; click one to open its questions." />
    </div>
  );
}
