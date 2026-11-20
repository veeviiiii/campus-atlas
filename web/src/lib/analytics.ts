// What a page view sends to Vercel Web Analytics (components/SiteAnalytics.tsx): the address without
// the part after #, and on /upload/ without the query too, where Supabase sign-in puts its one-time code.
// /admin/ is not counted at all: it is the maintainer looking at the numbers.

export const counted = (href: string) => !new URL(href).pathname.startsWith("/admin");


export function cleanViewUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  if (url.pathname.startsWith("/upload")) url.search = "";
  return url.toString();
}
