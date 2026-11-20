"use client";

import { useEffect, useRef } from "react";

import { HEAT, PLANET, WINTER } from "@/lib/colors";
import type { HeroCity } from "@/lib/home";
import { snowballSticks } from "@/lib/season";

interface Props {
  cities: HeroCity[];
  onPick: (city: HeroCity) => void;
}

const SPIN = 0.18; // radians a second when left alone (the same on a 60 Hz and a 120 Hz screen)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** A steady "random" number in 0..1 for the k-th thing, the same on every visit. */
const steady = (k: number) => {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** Grey-green and blue-grey patches in the old snow, spread over the snowball: they turn with it. Sizes
 *  are a share of the radius. */
const PATCHES = Array.from({ length: 48 }, (_, k) => ({
  lat: Math.asin(1 - (2 * (k + 0.5)) / 48) + (steady(k) - 0.5) * 0.3,
  lon: k * GOLDEN + (steady(k + 500) - 0.5) * 0.6,
  s: 0.25 + steady(k + 1000) * 0.35,
  green: steady(k + 1500) < 0.55,
  alpha: 0.18 + steady(k + 2500) * 0.2,
  shape: k % 3,
}));

/** A small picture drawn once and stamped many times. */
function sprite(size: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!);
  return c;
}

/** A soft patch with a ragged edge: a few soft blobs heaped together. */
const patchSprite = (rgb: string, shape: number) =>
  sprite(128, (g) => {
    for (let k = 0; k < 6; k++) {
      const j = shape * 10 + k;
      const x = 64 + (steady(j + 6000) - 0.5) * 50;
      const y = 64 + (steady(j + 7000) - 0.5) * 50;
      const r = 22 + steady(j + 8000) * 22;
      const b = g.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(${rgb},.55)`);
      b.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = b;
      g.fillRect(0, 0, 128, 128);
    }
  });

/** Grain over the snow, light and dark specks, like an old photo of it. */
const grainSprite = () =>
  sprite(128, (g) => {
    for (let k = 0; k < 2600; k++) {
      const light = k % 2 === 0;
      const a = light ? 0.1 + steady(k + 4000) * 0.14 : 0.05 + steady(k + 4000) * 0.1;
      g.fillStyle = `rgba(${light ? WINTER.glint : WINTER.grain},${a.toFixed(3)})`;
      g.fillRect(Math.floor(steady(k + 2000) * 128), Math.floor(steady(k + 3000) * 128), 1, 1);
    }
  });

/**
 * The premade design's 2D canvas planet (gradient sphere, halo, latitude lines, tilted orbit
 * ring, glowing squares), fed with the real topics: subjects cluster together, colour = heat.
 * In the winter look (lib/season.ts) it is a snowball of old, packed snow instead, with a few sticks
 * stuck in it: each stick is one of the most asked topics on the site.
 * Drag to turn it (it keeps the push for a moment, then eases back to its own spin); the topics
 * pop in when the page opens; it stops drawing while it is off screen.
 */
export default function HeroPlanet({ cities, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    const rad = Math.PI / 180;
    // the season script marks <html> before React runs (app/layout.tsx), so this is already set
    const winter = document.documentElement.dataset.season === "winter";
    // In winter only a few topics show, as sticks spread around the middle of the ball (where they look
    // like a snowman's arms); otherwise every topic, where its subject's cluster is.
    const sticks = winter ? snowballSticks(cities) : [];
    const pts = winter
      ? sticks.map((c, k) => ({
          c,
          lat: (-18 + steady(k + 31) * 40) * rad,
          lon: (k / sticks.length) * Math.PI * 2 + (steady(k + 41) - 0.5) * 0.4,
        }))
      : cities.map((c) => ({ c, lat: c.lat * rad, lon: c.lng * rad }));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (winter) cv.setAttribute("aria-label", "A snowball with sticks in it, each one of the most asked topics. Click a stick to open its questions.");
    const patches = winter ? [0, 1, 2].map((s) => ({ green: patchSprite(WINTER.patchGreen, s), blue: patchSprite(WINTER.patchBlue, s) })) : [];
    const grain = winter ? cx.createPattern(grainSprite(), "repeat") : null;
    // canvas fonts cannot read CSS variables: resolve next/font's generated family name once
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";
    const lift = new Float32Array(pts.length); // 0..1: how far each topic has grown under the pointer
    let W = 0;
    let D = 1; // device pixels per CSS pixel
    let rot = winter ? 1.1 : -pts[0]?.lon || 0;
    let vel = reduced ? 0 : SPIN; // radians a second
    let hov = -1;
    let drag: { x: number; t: number; m: number; v: number } | null = null;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    const born = last;
    // where each topic is on screen (x, y, z) and the line the pointer has to be near: from (ax, ay) to (bx, by)
    let P: { x: number; y: number; z: number; i: number; ax: number; ay: number; bx: number; by: number }[] = [];

    const size = () => {
      const r = cv.getBoundingClientRect();
      D = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      cv.width = r.width * D;
      cv.height = r.height * D;
      cx.setTransform(D, 0, 0, D, 0, 0);
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();

    const pr = (la: number, lo: number, R: number, c: number) => {
      const a = lo + rot;
      const x = Math.cos(la) * Math.sin(a);
      const y = Math.sin(la);
      const z = Math.cos(la) * Math.cos(a);
      return { x: c + x * R, y: c - y * R, z };
    };

    const planet = (R: number, c: number) => {
      const g = cx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R * 1.05);
      g.addColorStop(0, PLANET.lit);
      g.addColorStop(0.6, PLANET.core);
      g.addColorStop(1, PLANET.edge);
      cx.beginPath();
      cx.arc(c, c, R, 0, 7);
      cx.fillStyle = g;
      cx.fill();
      const h = cx.createRadialGradient(c, c, R * 0.95, c, c, R * 1.35);
      h.addColorStop(0, `rgba(${PLANET.halo},.45)`);
      h.addColorStop(1, `rgba(${PLANET.halo},0)`);
      cx.fillStyle = h;
      cx.beginPath();
      cx.arc(c, c, R * 1.35, 0, 7);
      cx.fill();
      cx.strokeStyle = `rgba(${PLANET.lines},.12)`;
      cx.lineWidth = 1;
      for (let la = -60; la <= 60; la += 30) {
        cx.beginPath();
        for (let lo = 0; lo <= 360; lo += 6) {
          const p = pr(la * rad, lo * rad, R, c);
          if (lo) cx.lineTo(p.x, p.y);
          else cx.moveTo(p.x, p.y);
        }
        cx.stroke();
      }
      cx.save();
      cx.translate(c, c);
      cx.rotate(-0.35);
      cx.scale(1, 0.3);
      cx.strokeStyle = `rgba(${PLANET.ring},.35)`;
      cx.beginPath();
      cx.arc(0, 0, R * 1.28, 0, 7);
      cx.stroke();
      cx.restore();
    };

    /** The snowball's edge: a few flat sides and a little uneven, as a hand-packed (and low-poly) ball is. */
    const outline = (R: number, c: number) => {
      cx.beginPath();
      for (let k = 0; k < 26; k++) {
        const th = (k / 26) * Math.PI * 2;
        const r = R * (1 + (steady(k + 77) - 0.5) * 0.03);
        if (k) cx.lineTo(c + r * Math.cos(th), c + r * Math.sin(th));
        else cx.moveTo(c + r * Math.cos(th), c + r * Math.sin(th));
      }
      cx.closePath();
    };

    const snowball = (R: number, c: number) => {
      const h = cx.createRadialGradient(c, c, R * 0.95, c, c, R * 1.28);
      h.addColorStop(0, `rgba(${WINTER.halo},.22)`);
      h.addColorStop(1, `rgba(${WINTER.halo},0)`);
      cx.fillStyle = h;
      cx.beginPath();
      cx.arc(c, c, R * 1.28, 0, 7);
      cx.fill();
      const g = cx.createRadialGradient(c - R * 0.3, c - R * 0.45, R * 0.05, c, c, R * 1.04);
      g.addColorStop(0, WINTER.lit);
      g.addColorStop(0.55, WINTER.core);
      g.addColorStop(1, WINTER.edge);
      outline(R, c);
      cx.fillStyle = g;
      cx.fill();
      cx.save();
      outline(R, c);
      cx.clip();
      // the patches, squashed towards the edge as the ball turns away
      for (const s of PATCHES) {
        const p = pr(s.lat, s.lon, R, c);
        if (p.z < -0.1) continue;
        const nx = p.x - c;
        const ny = p.y - c;
        const n2 = nx * nx + ny * ny;
        const z = Math.max(0.05, p.z);
        const q = n2 > 1e-6 ? (1 - z) / n2 : 0;
        const size = s.s * R * 2;
        cx.globalAlpha = s.alpha * Math.min(1, (p.z + 0.1) * 3);
        cx.setTransform(D * (1 - q * nx * nx), D * -q * nx * ny, D * -q * nx * ny, D * (1 - q * ny * ny), D * p.x, D * p.y);
        const pic = patches[s.shape];
        cx.drawImage(s.green ? pic.green : pic.blue, -size / 2, -size / 2, size, size);
      }
      cx.setTransform(D, 0, 0, D, 0, 0);
      cx.globalAlpha = 1;
      // blue-grey shade low down and on the right, away from the light
      const o = cx.createRadialGradient(c - R * 0.45, c - R * 0.55, R * 0.6, c - R * 0.2, c - R * 0.25, R * 1.5);
      o.addColorStop(0, `rgba(${WINTER.patchBlue},0)`);
      o.addColorStop(1, `rgba(${WINTER.patchBlue},.35)`);
      cx.fillStyle = o;
      cx.fillRect(c - R * 1.05, c - R * 1.05, R * 2.1, R * 2.1);
      if (grain) {
        cx.fillStyle = grain;
        cx.fillRect(c - R * 1.05, c - R * 1.05, R * 2.1, R * 2.1);
      }
      cx.restore();
    };

    /** A glowing square, coloured by heat. Returns its size, for the label. */
    const square = (i: number, x: number, y: number, z: number, grown: number) => {
      const city = pts[i].c;
      const col = HEAT[city.heat];
      const s = (5 + city.weight * 1.8) * (0.6 + 0.4 * z) * (1 + 0.4 * lift[i]) * grown;
      if (s < 0.5) return 0;
      cx.fillStyle = col;
      cx.shadowColor = col;
      cx.shadowBlur = 14;
      cx.fillRect(x - s / 2, y - s / 2, s, s);
      cx.shadowBlur = 0;
      return s;
    };

    /**
     * A stick pushed into the snow at the topic's place, slanting up and out like a snowman's arm, with a
     * fork near its end. Drawn foreshortened: short when it points at you, long at the edge. Returns its
     * far end (for the pointer and the label).
     */
    const stick = (i: number, x: number, y: number, z: number, grown: number, R: number, c: number) => {
      const { c: city, lat: la, lon } = pts[i];
      // sized for a 560px snowball; a smaller one shrinks them, to no less than 0.7 (a phone is about 310px)
      const sc = Math.max(0.7, R / 200) * (1 + 0.25 * lift[i]);
      const k = sc * grown;
      if (k < 0.05) return null;
      // the way out of the ball here (u), and the way along the snow up and to one side (t)
      const a = lon + rot;
      const u = { x: (x - c) / R, y: (c - y) / R, z };
      const phi = Math.PI / 2 + (i % 2 ? 0.9 : -0.9);
      const t = {
        x: Math.cos(phi) * Math.cos(a) - Math.sin(phi) * Math.sin(la) * Math.sin(a),
        y: Math.sin(phi) * Math.cos(la),
        z: -Math.cos(phi) * Math.sin(a) - Math.sin(phi) * Math.sin(la) * Math.cos(a),
      };
      const d = { x: 0.75 * u.x + 0.66 * t.x, y: 0.75 * u.y + 0.66 * t.y, z: 0.75 * u.z + 0.66 * t.z };
      const n = Math.hypot(d.x, d.y, d.z) || 1;
      const L = (46 + city.weight * 3) * k;
      const ex = x + (d.x / n) * L;
      const ey = y - (d.y / n) * L;
      const side = i % 2 ? 1 : -1;
      // a slight bend, then points and directions along it
      const mx = (x + ex) / 2 - (ey - y) * 0.08 * side;
      const my = (y + ey) / 2 + (ex - x) * 0.08 * side;
      const at = (f: number) => ({ x: (1 - f) ** 2 * x + 2 * (1 - f) * f * mx + f * f * ex, y: (1 - f) ** 2 * y + 2 * (1 - f) * f * my + f * f * ey });
      const dir = (f: number) => Math.atan2(2 * (1 - f) * (my - y) + 2 * f * (ey - my), 2 * (1 - f) * (mx - x) + 2 * f * (ex - mx));
      const len = Math.hypot(ex - x, ey - y);
      cx.globalAlpha = Math.min(1, z / 0.15); // fade in from the edge instead of popping out from behind it
      // the hole in the snow it is pushed into
      cx.fillStyle = `rgba(${WINTER.shade},.3)`;
      cx.beginPath();
      cx.ellipse(x, y, 3 * k, 2 * k, dir(0), 0, 7);
      cx.fill();
      cx.strokeStyle = WINTER.twig;
      cx.lineCap = "round";
      cx.lineJoin = "round";
      const w = (0.8 + 0.2 * z) * sc;
      // thicker where it goes into the snow, thinner towards the end: the curve split in two at f
      const f = 0.55;
      const m = at(f);
      cx.lineWidth = 3.2 * w;
      cx.beginPath();
      cx.moveTo(x, y);
      cx.quadraticCurveTo(x + f * (mx - x), y + f * (my - y), m.x, m.y);
      cx.stroke();
      cx.lineWidth = 2.2 * w;
      cx.beginPath();
      cx.moveTo(m.x, m.y);
      cx.quadraticCurveTo(mx + f * (ex - mx), my + f * (ey - my), ex, ey);
      cx.stroke();
      // the fork near its end, and a short twig at the tip
      cx.lineWidth = 1.6 * w;
      cx.beginPath();
      for (const [f, turn, l] of [
        [0.72, 0.6, 0.3],
        [1, -0.45, 0.14],
      ]) {
        const p = at(f);
        const g = dir(f) + turn * side;
        cx.moveTo(p.x, p.y);
        cx.lineTo(p.x + Math.cos(g) * l * len, p.y + Math.sin(g) * l * len);
      }
      cx.stroke();
      cx.globalAlpha = 1;
      return { ex, ey };
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!drag) {
        vel += ((reduced ? 0 : SPIN) - vel) * Math.min(1, dt * 2.2); // a push from a drag eases back to the planet's own spin
        rot += vel * dt;
      }
      const R = W * 0.36;
      const c = W / 2;
      cx.clearRect(0, 0, W, W);
      if (winter) snowball(R, c);
      else planet(R, c);

      P = pts.map((t, i) => {
        const p = pr(t.lat, t.lon, R, c);
        return { ...p, i, ax: p.x, ay: p.y, bx: p.x, by: p.y };
      });
      let label: { text: string; x: number; y: number } | null = null;
      P.slice()
        .sort((a, b) => a.z - b.z)
        .forEach((p) => {
          lift[p.i] += ((p.i === hov ? 1 : 0) - lift[p.i]) * Math.min(1, dt * 14);
          if (p.z < 0) return;
          // the topics pop in one after another when the page opens
          const delay = winter ? p.i * 120 : p.i * 9;
          const grown = reduced ? 1 : easeOut(Math.min(1, Math.max(0, (now - born - 250 - delay) / 550)));
          if (winter) {
            const s = stick(p.i, p.x, p.y, p.z, grown, R, c);
            if (!s) return;
            p.bx = s.ex;
            p.by = s.ey;
            if (p.i === hov) label = { text: pts[p.i].c.name, x: s.ex + 6, y: s.ey - 6 };
          } else {
            const s = square(p.i, p.x, p.y, p.z, grown);
            if (!s) return;
            if (p.i === hov) label = { text: pts[p.i].c.name, x: p.x + s / 2 + 4, y: p.y - s / 2 - 4 };
          }
        });
      if (label) {
        // drawn last, so no topic covers it; kept inside the canvas
        const { text, x, y } = label as { text: string; x: number; y: number };
        cx.font = `500 12px ${monoFamily}, monospace`;
        const w = cx.measureText(text).width;
        const lx = Math.max(8, Math.min(x, W - w - 8));
        const ly = Math.max(18, y);
        if (winter) {
          // white text would vanish on the snow: put it on a dark pill
          cx.fillStyle = WINTER.label;
          cx.beginPath();
          cx.roundRect(lx - 6, ly - 14, w + 12, 20, 10);
          cx.fill();
          cx.fillStyle = WINTER.labelInk;
        } else cx.fillStyle = "#fff";
        cx.fillText(text, lx, ly);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    /** How far (x, y) is from the line a-b (a point when a = b). */
    const away = (x: number, y: number, p: (typeof P)[number]) => {
      const dx = p.bx - p.ax;
      const dy = p.by - p.ay;
      const l2 = dx * dx + dy * dy;
      const f = l2 ? Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / l2)) : 0;
      return Math.hypot(p.ax + f * dx - x, p.ay + f * dy - y);
    };
    const hit = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = -1;
      let bd = winter ? 16 : 22;
      for (const p of P) {
        if (p.z < 0) continue;
        const d = away(x, y, p);
        if (d < bd) {
          bd = d;
          best = p.i;
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
        rot += d * 0.007;
        drag.v = (d * 0.007) / Math.max(0.008, (e.timeStamp - drag.t) / 1000);
        drag.x = e.clientX;
        drag.t = e.timeStamp;
      } else hov = hit(e);
      cursor();
    };
    const up = (e: PointerEvent) => {
      if (drag && drag.m < 6) {
        const i = hit(e);
        if (i >= 0) pickRef.current(pts[i].c);
      }
      // let go while still moving: the planet keeps that turn for a moment
      if (drag && drag.m >= 6 && e.timeStamp - drag.t < 80 && !reduced) vel = Math.max(-5, Math.min(5, drag.v));
      drag = null;
      cursor();
    };
    const cancel = () => {
      // the browser took the gesture (a scroll that began on the planet): the drag is over
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
      <canvas ref={ref} aria-label="Planet of the real topics. Click a topic to open its questions." />
    </div>
  );
}
