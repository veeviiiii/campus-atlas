// Colours shared by the hero planet, the subject cards' planets and the topic lists.

/** Heat: came back from a mid-sem in the End Sem / asked in 2+ exams / asked once. */
export const HEAT = { repeat: "#ff3b4e", multi: "#ff8a3d", once: "#ffc24a" } as const;
export type Heat = keyof typeof HEAT;

/** The planets (canvas cannot read CSS variables): the sphere's night side, its lit side, the violet
 *  halo, the latitude lines (lavender) and the orbit ring (cyan), as "r,g,b" where an alpha is added. */
export const PLANET = { lit: "#3a3a9a", core: "#15133a", edge: "#07071a", halo: "118,87,255", lines: "196,181,253", ring: "84,228,255" } as const;

/** The winter look (lib/season.ts) on the subject cards' planets, which hang as baubles: the silver cap and
 *  loop, the shade towards the rim and the shine ("r,g,b"). */
export const WINTER = { cap: "#d8d2c7", capShade: "#a09fb0", shade: "40,48,80", glint: "255,255,255" } as const;

/** The winter look's Christmas tree in the hero (ChristmasTree.tsx). Needles go from the dark inside of the
 *  tree to its lit tips (three stops, blended between); frost on the outer tips, from its shaded to its lit
 *  side; the trunk; the fairy lights (warm white and amber) and the star, with their glow ("r,g,b"); the
 *  snow on the ground and the shadow on it ("r,g,b"); the baubles (the site's palette), their shine and
 *  shade ("r,g,b"), silver cap and loop; the hover label's pill. The violet halo
 *  behind it is PLANET.halo, so it sits in the site like the planet does. */
export const TREE = {
  needleDark: "#04170f",
  needleMid: "#11553a",
  needleLit: "#62b56e",
  frostShade: "#7f97a8",
  frostLit: "#d4e4ec",
  trunkDark: "#24160d",
  trunkLit: "#6b4426",
  lightWarm: "255,236,190",
  lightAmber: "255,194,74",
  star: "#ffd36a",
  starCore: "#fff7dc",
  starGlow: "255,205,100",
  snow: "214,228,242",
  shadow: "2,6,5",
  baubles: ["#ff3b4e", "#ffc24a", "#7657ff", "#54e4ff", "#f08bf0", "#4268ff", "#ff786d"],
  shine: "255,255,255",
  depth: "0,0,0",
  cap: "#e8e4dc",
  capShade: "#8f8a99",
  loop: "#a09fb0",
  label: "#13121a",
  labelInk: "#ffffff",
} as const;

/** Field of study (catalog/davv.json) -> its dot and orb gradient on the course cards. */
export const FIELD_COLORS: Record<string, [string, string]> = {
  engineering: ["#4268ff", "#54e4ff"],
  "computer-applications": ["#7657ff", "#54e4ff"],
  management: ["#ff786d", "#ffc24a"],
  commerce: ["#ffc24a", "#d7ff52"],
  arts: ["#f08bf0", "#7657ff"],
  law: ["#ff3b4e", "#f08bf0"],
  pharmacy: ["#54e4ff", "#d7ff52"],
  media: ["#f08bf0", "#ffc24a"],
  other: ["#a09fb0", "#c4b5fd"],
};

/** One colour per subject, from the design palette. */
export const SUBJECT_COLORS = ["#4268ff", "#7657ff", "#54e4ff", "#ff786d", "#ffc24a", "#f08bf0", "#d7ff52"];
