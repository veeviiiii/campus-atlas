"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

import { cleanViewUrl } from "@/lib/analytics";

/**
 * Vercel Web Analytics: counts page views and visitors (no cookies) for the maintainer's dashboard on
 * vercel.com. It sends only from the deployed site, never in dev. Each address is cleaned first
 * (lib/analytics.ts).
 */
const beforeSend = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: cleanViewUrl(event.url) });

export default function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
