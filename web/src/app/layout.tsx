import type { Metadata } from "next";
import localFont from "next/font/local";

import PageEnter from "@/components/PageEnter";
import SoftScroll from "@/components/SoftScroll";
import "./globals.css";

// Fonts are files in the repo (./fonts, SIL Open Font License), so dev and build work offline.
const inter = localFont({ src: "./fonts/inter-latin.woff2", weight: "400 600", variable: "--font-inter" });
const display = localFont({ src: "./fonts/space-grotesk-latin.woff2", weight: "500 700", variable: "--font-space-grotesk" });
const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500" },
  ],
  variable: "--font-plex-mono",
  fallback: ["ui-monospace", "Consolas", "monospace"],
  adjustFontFallback: false,
});
const pixel = localFont({ src: "./fonts/silkscreen-700-latin.woff2", weight: "700", variable: "--font-silkscreen", adjustFontFallback: false });

export const metadata: Metadata = {
  title: "Campus Atlas",
  description:
    "See what your university actually asks. Past exam papers turned into a 3D knowledge planet, powered by Gemma 4, an open-weight model.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior: Next turns the CSS smooth scrolling off while it changes page, so a new page
    // starts at the top instead of animating there. suppressHydrationWarning: the subject page's inline
    // script may set data-deep-tab before React hydrates.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} ${display.variable} ${mono.variable} ${pixel.variable}`}
    >
      <body>
        <SoftScroll />
        <PageEnter>{children}</PageEnter>
      </body>
    </html>
  );
}
