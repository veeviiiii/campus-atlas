"use client";

import Link from "next/link";
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

/** Top bar shared by every page (blurs once the page scrolls). */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
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
          <circle cx="15" cy="15" r="12" fill="none" stroke="#7657FF" strokeWidth="3" />
          <path d="M3 15h24M15 3c-6 6-6 18 0 24" stroke="#C4B5FD" strokeWidth="2" fill="none" />
          <rect x="21" y="5" width="5" height="5" fill="#D7FF52" />
        </svg>
        campus atlas
      </Link>
      <ul>
        <li>
          <Link href="/#browse">Past papers</Link>
        </li>
        <li>
          <Link href="/#how">How it works</Link>
        </li>
        <li>
          <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            Add papers ↗
          </a>
        </li>
      </ul>
      <Link className="pill lime" href="/#browse">
        Find your course ↓
      </Link>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <>
      <footer>
        <div className="mono" style={{ color: "var(--muted)" }}>
          Campus Atlas · past papers of DAVV, Indore, read by an open-weight AI model and checked by our pipeline. Not an official
          university site.
        </div>
        <div className="mono" style={{ color: "var(--muted)", marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            Add your papers
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            Apache-2.0
          </a>
        </div>
      </footer>
      <div className="bn">
        <Link href="/">Home</Link>
        <Link href="/#browse">Papers</Link>
        <Link href="/#how">How</Link>
      </div>
    </>
  );
}
