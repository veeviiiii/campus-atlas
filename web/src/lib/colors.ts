// Colours shared by the hero planet, the subject cards' planets and the topic lists.

/** Heat: came back from a mid-sem in the End Sem / asked in 2+ exams / asked once. */
export const HEAT = { repeat: "#ff3b4e", multi: "#ff8a3d", once: "#ffc24a" } as const;
export type Heat = keyof typeof HEAT;

/** One colour per subject, from the design palette. */
export const SUBJECT_COLORS = ["#4268ff", "#7657ff", "#54e4ff", "#ff786d", "#ffc24a", "#f08bf0", "#d7ff52"];
