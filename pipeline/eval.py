"""Eval: does the pack find the repeats a human found by hand?

pipeline/eval/expected_repeats.json lists 19 MST -> End Sem repeats from a manual check of the
papers. A hit = the pack has a repeat_of link from an End Sem question to a question of that MST
in that subject, on that topic. "On that topic" is matched by TEXT (never question numbers): the
key phrase must be similar to the linked questions (open embedding model). Every hit prints the
two linked questions so a person can verify it.

Usage: python -m pipeline.eval [pack.json] [--write]   (--write stores the result in the pack)
"""

import json
import sys
from pathlib import Path

from pipeline.providers import ROOT
from pipeline.repeats import embedder, facets, full_text

DEFAULT_PACK = ROOT / "packs" / "davv-sdsf" / "mtech-aids-dual-sem1.json"
EXPECTED = ROOT / "pipeline" / "eval" / "expected_repeats.json"
KEY_SIM = 0.55  # key phrase vs BOTH linked questions (their best facet); true hits score >= 0.64


def norm(text: str) -> str:
    return text.replace(" ", "").replace("$", "").lower()


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pack_path = Path(args[0]) if args else DEFAULT_PACK
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))["expected"]
    model = embedder()

    hits, misses = [], []
    for e in expected:
        subj = next((s for s in pack["subjects"] if s["id"] == e["subject"]), None)
        qs = {q["id"]: q for u in (subj or {"units": []})["units"] for t in u["topics"] for q in t["questions"]}
        links = [(q, qs[r["id"]], r) for q in qs.values() if q["exam"] == "end" for r in q["repeat_of"]
                 if r["id"] in qs and qs[r["id"]]["exam"] == e["mst_exam"]]
        best = None
        if links:
            key = model.encode([e["key_phrase"]], normalize_embeddings=True)

            def side(q: dict) -> float:  # best facet (whole question or one sub-part) vs the key phrase
                return float((model.encode(facets(q), normalize_embeddings=True) @ key.T).max())

            anchor = norm(e.get("must_contain", ""))
            for end_q, mst_q, r in links:
                if anchor and not all(anchor in norm(full_text(q)) for q in (mst_q, end_q)):
                    continue
                s = min(side(mst_q), side(end_q))  # BOTH linked questions must be about the key phrase
                if best is None or s > best[0]:
                    best = (s, end_q, mst_q, r)
        if best and best[0] >= KEY_SIM:
            hits.append((e, best))
        else:
            misses.append((e, best))

    print(f"Repeat detection: found {len(hits)} of {len(expected)} expected\n")
    for e, (s, end_q, mst_q, r) in hits:
        print(f"HIT  #{e['n']:>2} {e['subject']} {e['mst_exam']}: {e['key_phrase']}   (key sim {s:.2f})")
        print(f"       {mst_q['exam']}: {full_text(mst_q)[:110]}")
        print(f"       end : {full_text(end_q)[:110]}   [{r['type']}, cos {r['similarity']}]")
    for e, best in misses:
        print(f"MISS #{e['n']:>2} {e['subject']} {e['mst_exam']}: {e['key_phrase']}")
        if best:
            print(f"       closest link (key sim {best[0]:.2f}): {full_text(best[2])[:80]} -> {full_text(best[1])[:80]}")
        else:
            print("       no MST -> End Sem link in this subject for that exam")

    if "--write" in sys.argv:  # the website shows this result; it is never typed in by hand
        pack.setdefault("harness", {})["eval"] = {
            "found": len(hits),
            "expected": len(expected),
            "misses": [e["n"] for e, _ in misses],
            "source": "pipeline/eval/expected_repeats.json",
        }
        pack_path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"\nwrote harness.eval to {pack_path}")


if __name__ == "__main__":
    main()
