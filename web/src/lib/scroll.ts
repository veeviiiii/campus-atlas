// Soft, eased scrolling for jumps within a page (#browse, a topic in Likely topics). The browser's
// own smooth scroll is short and abrupt; this one takes 0.7-1.3 s and eases in and out.
// Page changes don't use it: a new page starts at the top (see data-scroll-behavior in layout.tsx).

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease-in-out cubic

/** The next animation frame, or a timer if frames are paused (some embedded/background views), so a scroll never stalls. */
function nextFrame(fn: (now: number) => void): void {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    fn(performance.now());
  };
  const frame = requestAnimationFrame(run);
  const timer = setTimeout(run, 50);
}

export function softScrollTo(top: number): void {
  const start = window.scrollY;
  const distance = Math.max(0, top) - start;
  if (Math.abs(distance) < 2) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo({ top, behavior: "instant" });
    return;
  }
  const duration = Math.min(1300, Math.max(700, Math.abs(distance) * 0.6));
  const t0 = performance.now();
  let stopped = false;
  const stop = () => (stopped = true); // the reader takes over with the wheel, touch or keys
  const opts = { passive: true, once: true } as const;
  addEventListener("wheel", stop, opts);
  addEventListener("touchstart", stop, opts);
  addEventListener("keydown", stop, opts);
  const done = () => {
    removeEventListener("wheel", stop);
    removeEventListener("touchstart", stop);
    removeEventListener("keydown", stop);
  };
  const step = (now: number) => {
    if (stopped) return done();
    const t = Math.min(1, (now - t0) / duration);
    window.scrollTo({ top: start + distance * ease(t), behavior: "instant" }); // instant per frame: html has scroll-behavior: smooth
    if (t < 1) nextFrame(step);
    else done();
  };
  nextFrame(step);
}

/** Scroll so the element sits just below the fixed top bar (the page's scroll-padding-top). */
export function softScrollToElement(el: Element): void {
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  softScrollTo(el.getBoundingClientRect().top + window.scrollY - pad);
}
