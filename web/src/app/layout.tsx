import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import PageEnter from "@/components/PageEnter";
import SoftScroll from "@/components/SoftScroll";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "Campus Atlas: past papers of DAVV, Indore, by subject, exam and year" };

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

// Every page sets its own title, description and canonical link; these are the defaults. Pages leave
// openGraph alone so they keep the site name and the image (app/og.png); link previews take the page's
// own title and description.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Campus Atlas · Past papers of DAVV, Indore",
  description:
    "Past exam papers of DAVV, Indore, by course, semester and subject: every question as text with a photo of its page, the topics that keep coming back, and the marks by unit. Made by students.",
  openGraph: { siteName: "Campus Atlas", type: "website", locale: "en_IN", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE] },
};

// The phone browser's own bar takes the page's background (--background in globals.css).
export const viewport: Viewport = { themeColor: "#09090b" };

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
