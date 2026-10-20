"use client";

import { useEffect, useRef } from "react";

import { HEAT, type Heat } from "@/lib/colors";

export interface MiniTopic {
  heat: Heat;
  weight: number; // exams it was asked in, +1 if it came back in the End Sem
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * A small spinning planet for a subject card, drawn like the hero planet: a sphere tinted in the
 * subject's colour with one glowing square per topic (heat colours), spread evenly over the sphere.
 * Purely visual: the card around it is the link. Animates only while on screen.
 */
export default function MiniPlanet({ topics, tint }: { topics: MiniTopic[]; tint: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    const n = topics.length;
    // even spread over the sphere (Fibonacci lattice), kept away from the poles
    const pts = topics.map((t, i) => ({ t, lat: Math.asin(0.85 * (1 - (2 * (i + 0.5)) / n)), lon: i * GOLDEN }));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let rot = 0.6;
    let raf = 0;
    let visible = false;

    const size = () => {
      const r = cv.getBoundingClientRect();
      const d = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      cv.width = r.width * d;
      cv.height = r.height * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    };

    const draw = () => {
      const R = W * 0.34;
      const c = W / 2;
      cx.clearRect(0, 0, W, W);
      const h = cx.createRadialGradient(c, c, R * 0.95, c, c, R * 1.4);
      h.addColorStop(0, tint + "66");
      h.addColorStop(1, tint + "00");
      cx.fillStyle = h;
      cx.beginPath();
      cx.arc(c, c, R * 1.4, 0, 7);
      cx.fill();
      const g = cx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R * 1.05);
      g.addColorStop(0, tint + "aa");
      g.addColorStop(0.55, "#15133a");
      g.addColorStop(1, "#07071a");
      cx.beginPath();
      cx.arc(c, c, R, 0, 7);
      cx.fillStyle = g;
      cx.fill();
      cx.save();
      cx.translate(c, c);
      cx.rotate(-0.35);
      cx.scale(1, 0.3);
      cx.strokeStyle = "rgba(84,228,255,.3)";
      cx.lineWidth = 1;
      cx.beginPath();
      cx.arc(0, 0, R * 1.3, 0, 7);
      cx.stroke();
      cx.restore();

      pts
        .map((p) => {
          const a = p.lon + rot;
          return { p, x: c + Math.cos(p.lat) * Math.sin(a) * R, y: c - Math.sin(p.lat) * R, z: Math.cos(p.lat) * Math.cos(a) };
        })
        .filter((q) => q.z > 0)
        .sort((a, b) => a.z - b.z)
        .forEach(({ p, x, y, z }) => {
          const col = HEAT[p.t.heat];
          const s = (4 + p.t.weight * 1.5) * (0.55 + 0.45 * z);
          cx.fillStyle = col;
          cx.shadowColor = col;
          cx.shadowBlur = 8;
          cx.fillRect(x - s / 2, y - s / 2, s, s);
          cx.shadowBlur = 0;
        });
    };

    const frame = () => {
      rot += 0.006;
      draw();
      raf = visible && !reduced ? requestAnimationFrame(frame) : 0;
    };

    const ro = new ResizeObserver(() => {
      size();
      draw();
    });
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !reduced) raf = requestAnimationFrame(frame);
    });
    io.observe(cv);
    size();
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [topics, tint]);

  return <canvas ref={ref} className="mini-planet" aria-hidden="true" />;
}
