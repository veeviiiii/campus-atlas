// The winter look (snow and a snowball on the home page, baubles, a hat on the logo): all of it hangs on
// html[data-season="winter"], and all its styles are in app/winter.css, so one switch turns it all on or
// off. The switch is WINTER_LOOK, read when the site is built (set it in Vercel's environment variables,
// then redeploy):
//   auto (or unset)  on from 20 November to 6 January by the visitor's own date, every year, no new build
//   on               on every day
//   off              never; the site looks as it does the rest of the year

export type WinterMode = "auto" | "on" | "off";

/** WINTER_LOOK as written in the environment; anything else (or nothing) is "auto". */
export function winterMode(value: string | undefined): WinterMode {
  const v = value?.trim().toLowerCase();
  return v === "on" || v === "off" ? v : "auto";
}

/** Is this date in the winter window? */
export function isWinter(d: Date): boolean {
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return (month === 11 && day >= 20) || month === 12 || (month === 1 && day <= 6);
}

/** The same rule as an inline script for the top of <body>: it marks <html> before the first paint, so
 *  the page never flashes without the look. Kept equal to isWinter by web/tests/season.test.ts. */
export const SEASON_SCRIPT =
  'var d=new Date(),m=d.getMonth()+1,n=d.getDate();if((m===11&&n>=20)||m===12||(m===1&&n<=6))document.documentElement.setAttribute("data-season","winter")';

/** The script app/layout.tsx puts at the top of <body> for a mode: the date rule, "always", or none. */
export function seasonScript(mode: WinterMode): string | null {
  if (mode === "off") return null;
  return mode === "on" ? 'document.documentElement.setAttribute("data-season","winter")' : SEASON_SCRIPT;
}

/** Sticks on the winter snowball: a few, so it still looks like a snowball. */
export const SNOWBALL_STICKS = 7;

/** The topics that stick out of the winter snowball: each subject's most asked one (rank 0), then the
 *  most asked of those across the site (ties keep the site's order), at most n. */
export function snowballSticks<T extends { rank: number; weight: number }>(cities: T[], n = SNOWBALL_STICKS): T[] {
  return cities
    .filter((c) => c.rank === 0)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.weight - a.c.weight || a.i - b.i)
    .slice(0, n)
    .map(({ c }) => c);
}
