// College pack schema (CLAUDE.md section 7). The website reads only these files.

export interface RepeatLink {
  id: string;
  type: "exact" | "near" | "same-topic" | string;
}

export interface Question {
  id: string;
  exam: string;
  text: string;
  marks: number | null;
  has_table: boolean;
  table_markdown?: string | null;
  sub_parts?: string[] | null;
  is_or_choice?: boolean | null;
  page_ref: string;
  repeat_of: RepeatLink[];
  confidence?: number;
}

export interface Quiz {
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Topic {
  id: string;
  name: string;
  exams_count: number;
  is_repeat: boolean;
  total_marks: number;
  questions: Question[];
  quiz: Quiz[];
}

export interface Unit {
  id: string;
  name: string;
  from_syllabus: boolean;
  blind_spot: boolean;
  topics: Topic[];
  fog_topics: string[];
}

export interface Subject {
  id: string;
  name: string;
  aliases: string[];
  codes_seen: string[];
  units: Unit[];
  off_syllabus: Question[];
}

export interface College {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export interface Pack {
  schema_version: string;
  mock?: boolean;
  mock_note?: string;
  college: College;
  course: { id: string; name: string; semester: number };
  sources: {
    exams: { id: string; name: string; date: string; session?: string }[]; // session: "2025-26" (schema 1.1+)
    syllabus: { batch: string; note: string } | null;
    units_from?: string;
  };
  subjects: Subject[];
  unsure: unknown[];
  stats: { papers: number; questions: number; repeats: number; same_topic_links?: number; dropped_bleed_through: number };
  harness?: {
    model?: string;
    fallback_model?: string | null;
    embedding_model?: string;
    eval?: { found: number; expected: number; misses: number[]; source: string };
  };
}

/** A pack plus a stable key, as handed to the client. */
export interface PackEntry {
  key: string; // e.g. "davv-sdsf/mtech-aids-dual-sem1"
  pack: Pack;
}

// Course catalogue (catalog/<university>.json): every programme, with or without papers yet.

export interface Field {
  id: string;
  name: string; // "Engineering & Technology"
  short: string; // "Engineering", for chips
}

export interface CatalogCourse {
  id: string; // matches pack.course.id
  name: string;
  school: string;
  school_short?: string;
  college: string; // matches pack.college.id
  field: string;
  years: number;
  honours_year?: boolean; // the last year is the optional Honours/Research year (NEP 2020)
}

export interface Catalog {
  university: string;
  source: string;
  notes: string[];
  fields: Field[];
  courses: CatalogCourse[];
}

/** One semester of a course; `key` is set when a pack (papers) exists for it. */
export interface SemesterSlot {
  semester: number;
  key?: string;
  papers?: number;
  mock?: boolean;
}

/** A course as the home page and the course page show it: catalogue facts plus which semesters have papers. */
export interface CourseCard {
  id: string;
  name: string;
  school: string;
  schoolShort?: string;
  field: string;
  years: number | null; // null: not in the catalogue (a pack for a course the brochure doesn't list)
  honoursYear: boolean;
  semesters: SemesterSlot[]; // every semester of the course, or just the ones with papers when years is null
  subjects: string[]; // subject names from its packs, for search
}
