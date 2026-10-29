import { fmtMarks, marksSummary, type MarksTable } from "@/lib/marks";
import { examDate } from "@/lib/papers";

interface Props {
  table: MarksTable;
  examName: Record<string, string>; // exam id -> "MST-2" ("MST-2 2024-25" when the pack has several years)
}

/** A subject's marks by unit and exam. Each cell is shaded by its share of that exam's marks. */
export default function UnitMarks({ table, examName }: Props) {
  const { exams, rows, totals, unknown } = table;
  const grand = totals.reduce((a, b) => a + b, 0);
  return (
    <>
      {marksSummary(table).map((s) => (
        <p key={s} className="marks-insight">
          {s}
        </p>
      ))}
      <div className="marks-wrap">
        <table className="marks">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              {exams.map((e) => (
                <th key={e.id} scope="col">
                  {examName[e.id]}
                  <span>{examDate(e.date)}</span>
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ unit, marks, total }) => (
              <tr key={unit.id}>
                <th scope="row">
                  {unit.name}
                  {unit.blind_spot && <span className="badge blind">Not in mid-sems</span>}
                </th>
                {marks.map((m, i) => {
                  const share = totals[i] ? m / totals[i] : 0;
                  return (
                    <td
                      key={exams[i].id}
                      className={m ? "" : "none"}
                      style={m ? { background: `rgba(84, 228, 255, ${(0.06 + 0.5 * share).toFixed(2)})` } : undefined}
                      title={m ? `${fmtMarks(m)} of ${fmtMarks(totals[i])} marks in ${examName[exams[i].id]} (${Math.round(share * 100)}%)` : "Not asked"}
                    >
                      {m ? fmtMarks(m) : "–"}
                    </td>
                  );
                })}
                <td className="total">{fmtMarks(total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All units</th>
              {totals.map((m, i) => (
                <td key={exams[i].id}>{fmtMarks(m)}</td>
              ))}
              <td className="total">{fmtMarks(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">
        Marks of every question printed on the paper, added up by unit. Either-or choices both count, so an exam&apos;s column can add
        up to more than its maximum marks.{unknown > 0 && ` ${unknown} question${unknown === 1 ? " was" : "s were"} printed without marks and ${unknown === 1 ? "is" : "are"} not counted.`}{" "}
        {rows.some((r) => !r.unit.from_syllabus) && "Units are grouped from the questions themselves, so they may not match the units in your syllabus."}
      </p>
    </>
  );
}
