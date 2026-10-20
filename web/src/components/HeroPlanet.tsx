"use client";

import { useEffect, useRef } from "react";

import { HEAT } from "@/lib/colors";
import type { City } from "@/lib/planet";

interface Props {
  cities: City[];
  onPick: (city: City) => void;
}

/**
 * The premade design's 2D canvas planet (gradient sphere, halo, latitude lines, tilted orbit
 * ring, glowing squares), fed with the real topics: subjects cluster together, colour = heat.
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
    let W = 0;
    let rot = -pts[0]?.lon || 0;
    let hov = -1;
    let drag: { x: number; m: number } | null = null;
    let raf = 0;
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

    const frame = () => {
      if (!drag && !reduced) rot += 0.003;
      const R = W * 0.36;
      const c = W / 2;
      cx.clearRect(0, 0, W, W);
      const g = cx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R * 1.05);
      g.addColorStop(0, "#3a3a9a");
      g.addColorStop(0.6, "#15133a");
      g.addColorStop(1, "#07071a");
      cx.beginPath();
      cx.arc(c, c, R, 0, 7);
      cx.fillStyle = g;
      cx.fill();
      const h = cx.createRadialGradient(c, c, R * 0.95, c, c, R * 1.35);
      h.addColorStop(0, "rgba(118,87,255,.45)");
      h.addColorStop(1, "rgba(118,87,255,0)");
      cx.fillStyle = h;
      cx.beginPath();
      cx.arc(c, c, R * 1.35, 0, 7);
      cx.fill();
      cx.strokeStyle = "rgba(196,181,253,.12)";
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
      cx.strokeStyle = "rgba(84,228,255,.35)";
      cx.beginPath();
      cx.arc(0, 0, R * 1.28, 0, 7);
      cx.stroke();
      cx.restore();

      P = pts.map((t, i) => ({ ...pr(t.lat, t.lon, R, c), i }));
      P.slice()
        .sort((a, b) => a.z - b.z)
        .forEach((p) => {
          if (p.z < 0) return;
          const city = pts[p.i].c;
          const col = HEAT[city.heat];
          const weight = city.topic.exams_count + (city.topic.is_repeat ? 1 : 0);
          const s = (5 + weight * 1.8) * (0.6 + 0.4 * p.z) * (p.i === hov ? 1.4 : 1);
          cx.fillStyle = col;
          cx.shadowColor = col;
          cx.shadowBlur = 14;
          cx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
          cx.shadowBlur = 0;
          if (p.i === hov) {
            cx.fillStyle = "#fff";
            cx.font = `500 12px ${monoFamily}, monospace`;
            cx.fillText(city.topic.name, p.x + s, p.y - s);
          }
        });
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
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, m: 0 };
      cv.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const d = e.clientX - drag.x;
        drag.m += Math.abs(d);
        rot += d * 0.007;
        drag.x = e.clientX;
      } else hov = hit(e);
    };
    const up = (e: PointerEvent) => {
      if (drag && drag.m < 6) {
        const i = hit(e);
        if (i >= 0) pickRef.current(pts[i].c);
      }
      drag = null;
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
    };
  }, [cities]);

  return (
    <div className="hero-planet">
      <canvas ref={ref} aria-label="Planet of the real topics. Click a topic to open its questions." />
    </div>
  );
}
