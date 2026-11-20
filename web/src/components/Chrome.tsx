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
  if (pathname.startsWith("/send") || pathname.startsWith("/upload")) return "send";
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
        {/* Shown only in the winter look (lib/season.ts): a hat whose tip hangs off the left, towards the
            page's edge, and a little snow for the globe to sit in. */}
        <svg className="hat" width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
          <path d="M20 15C18 7 13 2 7 3C4 4 3 7 2 11C4 9 6 8 7 9C9 10 10 13 10 15z" fill="var(--santa)" />
          <rect x="7" y="13" width="14" height="4" rx="2" fill="var(--snow)" />
          <circle cx="2.5" cy="12" r="2.4" fill="var(--snow)" />
        </svg>
        <svg className="drift" width="40" height="9" viewBox="0 0 40 9" aria-hidden="true">
          <path d="M0 9C1 6 4 4 8 5c2-3 7-4 10-1 3-2 8-2 11 0 4-1 8 1 9 3 1 1 2 2 2 2z" fill="var(--snow)" />
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
