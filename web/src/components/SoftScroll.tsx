"use client";

import { useEffect } from "react";

import { softScrollToElement } from "@/lib/scroll";

/**
 * Links to a section of the page you are already on ("Past papers" -> #browse on the home page,
 * "Find your course") scroll there softly instead of with the browser's quick jump.
 * Listens in the capture phase so it runs before <Link>, which skips clicks already handled.
 */
export default function SoftScroll() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (!url.hash || url.origin !== location.origin || url.pathname !== location.pathname) return;
      const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!el) return;
      e.preventDefault();
      history.replaceState(history.state, "", url.hash);
      softScrollToElement(el);
    };
    addEventListener("click", onClick, true);
    return () => removeEventListener("click", onClick, true);
  }, []);
  return null;
}
