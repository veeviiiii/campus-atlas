"use client";

import { useEffect, useState } from "react";

const DURATION = 1400; // ms
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A number that counts up from 0 when the page opens. The static HTML holds the real number (for
 * no-JS and for search engines), screen readers get only the real number, and with reduced motion
 * it simply stays put.
 */
export default function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setShown(Math.round(easeOut(t) * value));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <>
      <span aria-hidden="true">{shown.toLocaleString("en-IN")}</span>
      <span className="sr-only">{value.toLocaleString("en-IN")}</span>
    </>
  );
}
