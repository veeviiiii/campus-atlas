"use client";

import katex from "katex";
import "katex/dist/katex.min.css";

/** Question text with $...$ (inline) and $$...$$ (display) maths rendered by KaTeX (bundled locally). */
export function MathText({ text }: { text: string }) {
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  return (
    <>
      {parts.map((p, i) => {
        const display = p.startsWith("$$") && p.endsWith("$$") && p.length > 4;
        const inline = !display && p.startsWith("$") && p.endsWith("$") && p.length > 2;
        if (!display && !inline) return <span key={i}>{p.trim() === "" ? " " : p}</span>;
        const tex = display ? p.slice(2, -2) : p.slice(1, -1);
        return (
          <span
            key={i}
            style={display ? { display: "block", margin: "4px 0" } : undefined}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false, output: "html", displayMode: display }) }}
          />
        );
      })}
    </>
  );
}

/** A markdown table (as written by the extractor) rendered as a real table (styled by `.q table`). */
export function MarkdownTable({ md }: { md: string }) {
  const rows = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !/^\|[\s:|-]+\|$/.test(l))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i}>
                <MathText text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <MathText text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
