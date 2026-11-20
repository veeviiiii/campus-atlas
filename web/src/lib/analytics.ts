// What a page view sends to Vercel Web Analytics (components/SiteAnalytics.tsx): the address without
// the part after #, and on /upload/ without the query too, where Supabase sign-in puts its one-time code.

export function cleanViewUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  if (url.pathname.startsWith("/upload")) url.search = "";
  return url.toString();
}
