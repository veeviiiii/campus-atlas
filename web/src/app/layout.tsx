import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import PageEnter from "@/components/PageEnter";
import SiteAnalytics from "@/components/SiteAnalytics";
import SoftScroll from "@/components/SoftScroll";
import { seasonScript, winterMode } from "@/lib/season";
import { SITE_URL } from "@/lib/site";
import "./globals.css";
import "./winter.css";

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
  applicationName: "Campus Atlas",
  // The home page's search result. Short enough (under about 150 characters) not to be cut off.
  title: "Campus Atlas · DAVV previous year papers by subject",
  description:
    "Free previous year papers for DAVV, Indore, by subject: every MST and End Sem question, a photo of each page, and the topics asked most often.",
  openGraph: { siteName: "Campus Atlas", type: "website", locale: "en_IN", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE] },
};

// The phone browser's own bar takes the page's background (--background in globals.css).
export const viewport: Viewport = { themeColor: "#09090b" };

// The winter look's one switch (lib/season.ts), read at build time: WINTER_LOOK = auto, on or off.
const WINTER_SCRIPT = seasonScript(winterMode(process.env.WINTER_LOOK));

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior: Next turns the CSS smooth scrolling off while it changes page, so a new page
    // starts at the top instead of animating there. suppressHydrationWarning: inline scripts may set
    // data-season (below) and the subject page's data-deep-tab before React hydrates.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} ${display.variable} ${mono.variable} ${pixel.variable}`}
    >
      <body>
        {/* The winter look (lib/season.ts): marks <html> before the first paint. None when it is switched off. */}
        {WINTER_SCRIPT && <script dangerouslySetInnerHTML={{ __html: WINTER_SCRIPT }} />}
        <SoftScroll />
        <PageEnter>{children}</PageEnter>
        <SiteAnalytics />
      </body>
    </html>
  );
}
