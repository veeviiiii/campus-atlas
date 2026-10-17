"use client";

// UI languages from the design. English is the source; Hindi is a partial, AI-written translation
// that nobody has reviewed yet (and is labelled that way). The other languages have no pack:
// no trusted pack source is configured, so they fall back to English.

import { useCallback } from "react";

import { useLocal } from "./progress";

// [code, native name, English name, direction]
export const LANGS: [string, string, string, ("rtl" | "ltr")?][] = [
  ["en", "English", "English"],
  ["hi", "हिन्दी", "Hindi"],
  ["bn", "বাংলা", "Bengali"],
  ["te", "తెలుగు", "Telugu"],
  ["mr", "मराठी", "Marathi"],
  ["ta", "தமிழ்", "Tamil"],
  ["gu", "ગુજરાતી", "Gujarati"],
  ["kn", "ಕನ್ನಡ", "Kannada"],
  ["ml", "മലയാളം", "Malayalam"],
  ["pa", "ਪੰਜਾਬੀ", "Punjabi"],
  ["or", "ଓଡ଼ିଆ", "Odia"],
  ["as", "অসমীয়া", "Assamese"],
  ["ur", "اردو", "Urdu", "rtl"],
  ["sa", "संस्कृतम्", "Sanskrit"],
  ["kok", "कोंकणी", "Konkani"],
  ["ne", "नेपाली", "Nepali"],
  ["doi", "डोगरी", "Dogri"],
  ["ks", "کٲشُر", "Kashmiri", "rtl"],
  ["brx", "बड़ो", "Bodo"],
  ["sat", "ᱥᱟᱱᱛᱟᱲᱤ", "Santali"],
  ["sd", "سنڌي", "Sindhi", "rtl"],
  ["mni", "ꯃꯩꯇꯩꯂꯣꯟ", "Meitei"],
];

const EN = {
  explore: "Explore",
  tools: "Study tools",
  how: "How it works",
  camp: "Find your campus",
  oss: "Open source",
  enter: "Enter your atlas",
  data: "Data",
  pattern_k: "Read the pattern",
  pattern_h: "Some topics leave a bigger footprint.",
  fog_k: "Fog of war",
  fog_h: "The more you learn, the more you see.",
  exam_k: "Exam tomorrow",
  exam_h: "One night. One smarter route.",
  archive_k: "Question archive",
  archive_h: "Don't guess what was asked. Look.",
  space_k: "Study space",
  space_h: "Your tools for this semester.",
  nc: "Constellation",
  nm: "Mentee",
  nk: "Community",
  np: "My Atlas",
  nl: "Languages",
  why: "Why this topic matters",
  route: "Plan study route",
  mh: "Quiz builder",
  make: "Create quiz",
  take: "Start quiz",
  loc: "Stored on this device only. Sharing, join codes, teams and leaderboards need a backend that is not connected.",
  ph: "Your Atlas profile",
  pkn: "Community needs a shared backend, which is not connected yet. Nothing here is simulated.",
  sh: "Your language. Your learning universe.",
  search: "Search",
  back: "Back",
};
export type TKey = keyof typeof EN;

const HI: Partial<Record<TKey, string>> = {
  explore: "अन्वेषण",
  tools: "अध्ययन उपकरण",
  how: "यह कैसे काम करता है",
  camp: "अपना कैंपस खोजें",
  oss: "ओपन सोर्स",
  enter: "अपने एटलस में जाएँ",
  data: "डेटा",
  pattern_k: "पैटर्न पढ़ें",
  pattern_h: "कुछ विषयों की छाप बड़ी होती है।",
  fog_k: "कोहरा",
  fog_h: "जितना सीखेंगे, उतना देखेंगे।",
  exam_k: "कल परीक्षा",
  exam_h: "एक रात। एक समझदार रास्ता।",
  archive_k: "प्रश्न संग्रह",
  archive_h: "अंदाज़ा न लगाएँ कि क्या पूछा गया। देखें।",
  space_k: "अध्ययन कक्ष",
  space_h: "इस सेमेस्टर के लिए आपके उपकरण।",
  nc: "नक्षत्र-मानचित्र",
  nm: "मेंटी",
  nk: "समुदाय",
  np: "मेरा एटलस",
  nl: "भाषाएँ",
  why: "यह विषय क्यों महत्वपूर्ण है",
  route: "अध्ययन मार्ग बनाएँ",
  mh: "क्विज़ बिल्डर",
  make: "क्विज़ बनाएँ",
  take: "क्विज़ शुरू करें",
  loc: "केवल इसी डिवाइस पर सहेजा गया। साझा करने, कोड, टीम और लीडरबोर्ड के लिए बैकएंड चाहिए, जो जुड़ा नहीं है।",
  ph: "आपकी एटलस प्रोफ़ाइल",
  pkn: "समुदाय के लिए साझा बैकएंड चाहिए, जो अभी जुड़ा नहीं है। यहाँ कुछ भी नकली नहीं है।",
  sh: "आपकी भाषा। आपका सीखने का ब्रह्मांड।",
  search: "खोजें",
  back: "पीछे",
};
const BUILT: Record<string, Partial<Record<TKey, string>>> = { hi: HI };

export function langStatus(code: string): string {
  if (code === "en") return "Built in (source language)";
  if (BUILT[code]) return "Built in · AI-written, unreviewed (partial)";
  return "Pack unavailable · shows English";
}

export function useLang(): [string, (code: string) => void] {
  return useLocal("atlas:lang", "en");
}

export function useT(): (key: TKey) => string {
  const [lang] = useLang();
  return useCallback((key: TKey) => BUILT[lang]?.[key] ?? EN[key], [lang]);
}

export function dirOf(code: string): "rtl" | "ltr" {
  return LANGS.find((l) => l[0] === code)?.[3] ?? "ltr";
}
