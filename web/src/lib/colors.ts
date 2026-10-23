// Colours shared by the hero planet, the subject cards' planets and the topic lists.

/** Heat: came back from a mid-sem in the End Sem / asked in 2+ exams / asked once. */
export const HEAT = { repeat: "#ff3b4e", multi: "#ff8a3d", once: "#ffc24a" } as const;
export type Heat = keyof typeof HEAT;

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
