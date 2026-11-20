"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

import { cleanViewUrl, counted } from "@/lib/analytics";

/**
 * Vercel Web Analytics: counts page views and visitors (no cookies) for the maintainer's dashboard on
 * vercel.com and /admin/. It sends only from the deployed site, never in dev. Each address is cleaned
 * first, and /admin/ is not counted (lib/analytics.ts).
 */
const beforeSend = (event: BeforeSendEvent): BeforeSendEvent | null => (counted(event.url) ? { ...event, url: cleanViewUrl(event.url) } : null);

export default function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
