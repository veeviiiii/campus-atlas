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

/**
 * The tree, once: tiers of branches round the trunk (more and longer ones low down), each rising a little
 * off the trunk and then drooping, with side twigs of needles along it, and a leader at the top. Every
 * needle is a short stroke. Deterministic: the same tree on every visit.
 */
function grow(): Float32Array {
  const out: number[] = [];
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
  return new Float32Array(out);
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

    const needles = grow();
    const count = needles.length / NEEDLE;
    const screen = new Float32Array(count * 4); // each needle's two ends on screen
    const keys = new Uint16Array(count); // depth slice and shade
    const order = new Uint32Array(count);
    const starts = new Uint32Array(SLICES * GROUPS + 1);

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
    let slow = 0; // how slow frames have been lately, in ms (an average that forgets)

    const size = () => {
      const r = cv.getBoundingClientRect();
      D = Math.min(devicePixelRatio || 1, 1.5);
      W = r.width;
      cv.width = r.width * D;
      cv.height = r.height * D;
      cx.setTransform(D, 0, 0, D, 0, 0);
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
    /** Puts (x, y, z) on screen in px, py; returns its depth (towards the eye) and sets the scale in f. */
    const project = (x: number, y: number, z: number) => {
      const xr = x * cosT - z * sinT;
      const zr = x * sinT + z * cosT;
      const yv = y * cosP - zr * sinP;
      const zv = zr * cosP + y * sinP;
      f = EYE / (EYE - zv);
      px = midX + xr * S * f;
      py = midY - (yv - 0.5 * cosP) * S * f;
      return zv;
    };
    const sliceOf = (zv: number) => Math.max(0, Math.min(SLICES - 1, Math.floor(((zv + BASE * 1.05 - 0.1 * sinP) / (BASE * 2.1 + 0.2 * sinP)) * SLICES)));
    // the light comes from the upper left, in front
    const lx = -0.5;
    const ly = 0.55;
    const lz = 0.67;

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
      const sc = Math.max(0.6, W / 560);
      const age = now - born;
      cx.clearRect(0, 0, W, W);

      // the violet halo behind it, as behind the planet, and the snow it stands in
      const h = cx.createRadialGradient(midX, midY, 0, midX, midY, W * 0.5);
      h.addColorStop(0, `rgba(${PLANET.halo},.22)`);
      h.addColorStop(1, `rgba(${PLANET.halo},0)`);
      cx.fillStyle = h;
      cx.fillRect(0, 0, W, W);
      project(0, -0.03, 0);
      const gx = px;
      const gy = py;
      const rx = BASE * 1.45 * S;
      cx.save();
      cx.translate(gx, gy);
      cx.scale(1, sinP * 1.4);
      const snow = cx.createRadialGradient(0, 0, 0, 0, 0, rx);
      snow.addColorStop(0, `rgba(${TREE.snow},.5)`);
      snow.addColorStop(0.6, `rgba(${TREE.snow},.18)`);
      snow.addColorStop(1, `rgba(${TREE.snow},0)`);
      cx.fillStyle = snow;
      cx.beginPath();
      cx.arc(0, 0, rx, 0, TAU);
      cx.fill();
      const shade = cx.createRadialGradient(0, 0, 0, 0, 0, rx * 0.6);
      shade.addColorStop(0, `rgba(${TREE.shadow},.55)`);
      shade.addColorStop(1, `rgba(${TREE.shadow},0)`);
      cx.fillStyle = shade;
      cx.beginPath();
      cx.arc(0, 0, rx * 0.6, 0, TAU);
      cx.fill();
      cx.restore();

      // every needle on screen, with its depth slice and shade; then sorted by both (a counting sort)
      if (age > 1500 && dt > 0) {
        slow += (dt * 1000 - slow) * 0.05;
        if (slow > 26 && thin < 3) {
          thin++;
          slow = 0;
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
        const g = needles[o + 9] ? LEVELS + Math.min(FROSTS - 1, Math.floor(lit * 1.4 * FROSTS)) : Math.min(LEVELS - 1, Math.floor(lit * 1.25 * LEVELS));
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

      const trunkSlice = sliceOf(0.12 * sinP);
      cx.lineCap = "round";
      cx.lineWidth = Math.max(0.9, 1.3 * sc);
      for (let s = 0; s < SLICES; s++) {
        if (s === trunkSlice) {
          project(0, -0.03, 0);
          const tx = px;
          const ty = py;
          project(0, 0.14, 0);
          const tw = 0.032 * S * f;
          const bark = cx.createLinearGradient(tx - tw, 0, tx + tw, 0);
          bark.addColorStop(0, TREE.trunkDark);
          bark.addColorStop(0.35, TREE.trunkLit);
          bark.addColorStop(1, TREE.trunkDark);
          cx.fillStyle = bark;
          cx.fillRect(tx - tw, py, tw * 2, ty - py);
        }
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

      // the star on top, always facing the eye, with a soft glow and a slow sparkle
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
        cx.strokeStyle = `rgba(${TREE.starGlow},${(0.35 * pulse).toFixed(3)})`;
        cx.lineWidth = 1;
        cx.beginPath();
        cx.moveTo(px - R * 2.6 * pulse, py);
        cx.lineTo(px + R * 2.6 * pulse, py);
        cx.moveTo(px, py - R * 2.4 * pulse);
        cx.lineTo(px, py + R * 2.4 * pulse);
        cx.stroke();
        cx.globalCompositeOperation = "source-over";
        const sway = reduced ? 0 : Math.sin(now / 1300) * 0.08;
        const body = cx.createRadialGradient(px - R * 0.2, py - R * 0.25, 0, px, py, R);
        body.addColorStop(0, TREE.starCore);
        body.addColorStop(1, TREE.star);
        cx.fillStyle = body;
        cx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + sway + (k * Math.PI) / 5;
          const rr = k % 2 ? R * 0.44 : R;
          if (k) cx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
          else cx.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
        }
        cx.closePath();
        cx.fill();
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
        rot += d * 0.008;
        drag.v = (d * 0.008) / Math.max(0.008, (e.timeStamp - drag.t) / 1000);
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
