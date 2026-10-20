import { MarkdownTable, MathText } from "./QuestionText";
import { pageImageUrl } from "@/lib/paths";
import type { Question } from "@/lib/types";

const REPEAT_LABEL: Record<string, string> = { exact: "word for word", near: "nearly the same", "same-topic": "same topic" };

/** Sub-parts not already spelled out in the question text (the extractor often lists them in both). */
function extraParts(q: Question): string[] {
  const squash = (s: string) =>
    s
      .toLowerCase()
      .replace(/^\s*(\(?[a-z0-9ivx]+[).]\s*)/i, "")
      .replace(/[^a-z0-9]/g, "");
  const text = squash(q.text);
  return (q.sub_parts ?? []).filter((p) => !text.includes(squash(p)));
}

interface Props {
  q: Question;
  collegeId: string;
  examName: Record<string, string>; // exam id -> "MST-2"
  examOf: Map<string, string>; // question id -> exam id (for "Repeated from ...")
  cameBack?: { exam: string; type: string };
  number?: number; // position on the paper
  topic?: { name: string; onOpen: () => void };
}

/** One question as the student sees it: text (maths, tables), marks, repeat badges, original page. */
export default function QuestionCard({ q, collegeId, examName, examOf, cameBack, number, topic }: Props) {
  const parts = extraParts(q);
  return (
    <div className="q">
      {(q.repeat_of.length > 0 || cameBack) && (
        <div className="badges">
          {q.repeat_of.map((r) => (
            <span key={r.id} className="badge repeat">
              Repeated from {examName[examOf.get(r.id) ?? ""] ?? "an earlier exam"} · {REPEAT_LABEL[r.type] ?? r.type}
            </span>
          ))}
          {cameBack && (
            <span className="badge repeat">
              Came back in {examName[cameBack.exam]} · {REPEAT_LABEL[cameBack.type] ?? cameBack.type}
            </span>
          )}
        </div>
      )}
      <p style={{ margin: 0 }}>
        {number != null && <b className="qno">Q{number}.</b>}
        <MathText text={q.text} />
      </p>
      {parts.length > 0 && (
        <ul className="parts">
          {parts.map((s, i) => (
            <li key={i}>
              <MathText text={s} />
            </li>
          ))}
        </ul>
      )}
      {q.has_table && q.table_markdown && <MarkdownTable md={q.table_markdown} />}
      <div className="mono qmeta">
        {q.marks != null && <span>{q.marks} marks</span>}
        {topic && (
          <button type="button" className="linkish" onClick={topic.onOpen}>
            Topic: {topic.name}
          </button>
        )}
        <a href={pageImageUrl(collegeId, q.page_ref)} target="_blank" rel="noreferrer">
          Original page ↗
        </a>
      </div>
    </div>
  );
}
