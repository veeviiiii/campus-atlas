"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const REPO_URL = "https://github.com/veeviiiii/campus-atlas";

/** A "← back" button and where you are, at the top of every inner page. */
export function BackBar({ href, label, where }: { href: string; label: string; where: string }) {
  return (
    <nav className="crumbs" aria-label="Back">
      <Link className="back" href={href}>
        ← {label}
      </Link>
      <span className="mono">{where}</span>
    </nav>
  );
}

/** Which part of the site a path belongs to, for the mark on the top and bottom bars. */
function sectionOf(pathname: string): "home" | "papers" | "search" | "send" {
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/send")) return "send";
  return pathname.startsWith("/course") || pathname.startsWith("/c/") ? "papers" : "home";
}

/** Top bar shared by every page (blurs once the page scrolls). */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const section = sectionOf(usePathname());
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`top ${scrolled ? "s" : ""}`}>
      <Link className="logo" href="/">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="12" fill="none" stroke="var(--primary)" strokeWidth="3" />
          <path d="M3 15h24M15 3c-6 6-6 18 0 24" stroke="var(--lav)" strokeWidth="2" fill="none" />
          <rect x="21" y="5" width="5" height="5" fill="var(--accent)" />
        </svg>
        campus atlas
      </Link>
      <ul>
        <li>
          <Link href="/#browse" aria-current={section === "papers" ? "true" : undefined}>
            Past papers
          </Link>
        </li>
        <li>
          <Link href="/search/" aria-current={section === "search" ? "page" : undefined}>
            Search
          </Link>
        </li>
        <li>
          <Link href="/#how">How it works</Link>
        </li>
        <li>
          <Link href="/send/" aria-current={section === "send" ? "page" : undefined}>
            Send papers
          </Link>
        </li>
      </ul>
      <Link className="pill lime" href="/#browse">
        Find your course ↓
      </Link>
    </nav>
  );
}

/** The bar at the bottom of the screen on a phone (hidden on wider screens, where the top bar has the links). */
export function BottomBar() {
  const section = sectionOf(usePathname());
  const on = (s: string) => (section === s ? "on" : undefined);
  return (
    <div className="bn">
      <Link href="/" className={on("home")}>
        Home
      </Link>
      <Link href="/#browse" className={on("papers")}>
        Papers
      </Link>
      <Link href="/search/" className={on("search")}>
        Search
      </Link>
      <Link href="/send/" className={on("send")}>
        Send
      </Link>
    </div>
  );
}
