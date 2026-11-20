"use client";

import { useEffect, useRef } from "react";

import { HEAT, PLANET } from "@/lib/colors";
import type { HeroCity } from "@/lib/home";

interface Props {
  cities: HeroCity[];
  onPick: (city: HeroCity) => void;
}

const SPIN = 0.18; // radians a second when left alone (the same on a 60 Hz and a 120 Hz screen)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The premade design's 2D canvas planet (gradient sphere, halo, latitude lines, tilted orbit
 * ring, glowing squares), fed with the real topics: subjects cluster together, colour = heat.
 * Drag to turn it (it keeps the push for a moment, then eases back to its own spin); the squares
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
    const pts = cities.map((c) => ({ c, lat: c.lat * rad, lon: c.lng * rad }));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // canvas fonts cannot read CSS variables: resolve next/font's generated family name once
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";
    const lift = new Float32Array(pts.length); // 0..1: how far each square has grown under the pointer
    let W = 0;
    let rot = -pts[0]?.lon || 0;
    let vel = reduced ? 0 : SPIN; // radians a second
    let hov = -1;
    let drag: { x: number; t: number; m: number; v: number } | null = null;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    const born = last;
    let P: { x: number; y: number; z: number; i: number }[] = [];

    const size = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      cv.width = r.width * d;
      cv.height = r.height * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
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

      P = pts.map((t, i) => ({ ...pr(t.lat, t.lon, R, c), i }));
      let label: { text: string; x: number; y: number } | null = null;
      P.slice()
        .sort((a, b) => a.z - b.z)
        .forEach((p) => {
          lift[p.i] += ((p.i === hov ? 1 : 0) - lift[p.i]) * Math.min(1, dt * 14);
          if (p.z < 0) return;
          const city = pts[p.i].c;
          const col = HEAT[city.heat];
          // the squares pop in one after another when the page opens
          const grown = reduced ? 1 : easeOut(Math.min(1, Math.max(0, (now - born - 250 - p.i * 9) / 550)));
          const s = (5 + city.weight * 1.8) * (0.6 + 0.4 * p.z) * (1 + 0.4 * lift[p.i]) * grown;
          if (s < 0.5) return;
          cx.fillStyle = col;
          cx.shadowColor = col;
          cx.shadowBlur = 14;
          cx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
          cx.shadowBlur = 0;
          if (p.i === hov) label = { text: city.name, x: p.x + s, y: p.y - s };
        });
      if (label) {
        // drawn last, so no square covers it; kept inside the canvas
        const { text, x, y } = label as { text: string; x: number; y: number };
        cx.font = `500 12px ${monoFamily}, monospace`;
        const w = cx.measureText(text).width;
        cx.fillStyle = "#fff";
        cx.fillText(text, Math.max(4, Math.min(x, W - w - 4)), Math.max(14, y));
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const hit = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = -1;
      let bd = 22;
      for (const p of P) {
        if (p.z < 0) continue;
        const d = Math.hypot(p.x - x, p.y - y);
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
