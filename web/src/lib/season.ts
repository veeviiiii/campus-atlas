// The winter look (snow on the home page, a hat on the logo): on from 20 November to 6 January, by the
// visitor's own date, so it switches itself on and off with no new build. Everything else is in
// globals.css under html[data-season="winter"].

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
