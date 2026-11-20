// Colours shared by the hero planet, the subject cards' planets and the topic lists.

/** Heat: came back from a mid-sem in the End Sem / asked in 2+ exams / asked once. */
export const HEAT = { repeat: "#ff3b4e", multi: "#ff8a3d", once: "#ffc24a" } as const;
export type Heat = keyof typeof HEAT;

/** The planets (canvas cannot read CSS variables): the sphere's night side, its lit side, the violet
 *  halo, the latitude lines (lavender) and the orbit ring (cyan), as "r,g,b" where an alpha is added. */
export const PLANET = { lit: "#3a3a9a", core: "#15133a", edge: "#07071a", halo: "118,87,255", lines: "196,181,253", ring: "84,228,255" } as const;

/** The winter look (lib/season.ts). The hero planet is a snowball of old, packed snow: its lit side, its
 *  blue-grey shade and its rim, a cool halo, then ("r,g,b") the grey-green and blue-grey patches in it, the
 *  grain, the shadow where a stick goes in; the sticks. The subject cards' planets are baubles: a silver cap
 *  and loop, and a shine ("r,g,b"). Last, the hover label's pill, which has to read on white snow. */
export const WINTER = {
  lit: "#eef3f5",
  core: "#cfdbe2",
  edge: "#7f95a6",
  halo: "200,225,255",
  patchGreen: "138,160,148",
  patchBlue: "112,138,164",
  grain: "60,72,84",
  shade: "40,48,80",
  glint: "255,255,255",
  twig: "#5e3a30",
  cap: "#d8d2c7",
  capShade: "#a09fb0",
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
