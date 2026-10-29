import { ImageResponse } from "next/og";

import { loadPacks } from "@/lib/packs";

// /og.png: the preview card shown when a Campus Atlas link is shared (WhatsApp, Telegram, LinkedIn...),
// drawn at build time with next/og; layout.tsx points every page at it. A route ending in .png rather
// than the opengraph-image convention, whose static file has no extension (so no image content type).
// Numbers come from the packs, like everything else.
export const dynamic = "force-static";

const size = { width: 1200, height: 630 };

// Pixel squares on the planet, as on the site's hero: [x, y, colour] in a 7 x 7 grid.
const SQUARES: [number, number, string][] = [
  [2, 1, "#ff3b4e"], [3, 1, "#ffc24a"], [1, 2, "#ff8a3d"], [4, 2, "#ff3b4e"], [5, 2, "#ffc24a"], [2, 3, "#ffc24a"],
  [3, 3, "#ff3b4e"], [5, 3, "#ff8a3d"], [1, 4, "#ffc24a"], [3, 4, "#ff8a3d"], [4, 4, "#ffc24a"], [2, 5, "#ff8a3d"], [4, 5, "#ff3b4e"],
];

export function GET() {
  const entries = loadPacks().filter((e) => !e.pack.mock);
  const total = (k: "papers" | "questions") => entries.reduce((n, e) => n + e.pack.stats[k], 0);
  const pill = {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    whiteSpace: "nowrap",
    height: 62,
    padding: "0 22px",
    borderRadius: 999,
    border: "2px solid rgba(255,255,255,0.14)",
    background: "#202027",
  };

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#09090b", color: "#fff", padding: "60px 72px", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            right: -70,
            top: 105,
            width: 420,
            height: 420,
            borderRadius: 999,
            backgroundImage: "radial-gradient(circle at 35% 30%, #7657ff, #4268ff 55%, #1b1440)",
            display: "flex",
          }}
        >
          {SQUARES.map(([x, y, c]) => (
            <div key={`${x}-${y}`} style={{ position: "absolute", left: x * 60, top: y * 60, width: 46, height: 46, background: c, borderRadius: 4 }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 740 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36 }}>
            <svg width="58" height="58" viewBox="0 0 30 30">
              <circle cx="15" cy="15" r="12" fill="none" stroke="#7657FF" strokeWidth="3" />
              <path d="M3 15h24M15 3c-6 6-6 18 0 24" stroke="#C4B5FD" strokeWidth="2" fill="none" />
              <rect x="21" y="5" width="5" height="5" fill="#D7FF52" />
            </svg>
            campus atlas
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ fontSize: 92, lineHeight: 1, letterSpacing: "-0.04em" }}>Past papers of DAVV, Indore</div>
            <div style={{ fontSize: 34, lineHeight: 1.3, color: "#a09fb0" }}>
              Every question by subject, exam and year, with the topics that keep coming back.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 26 }}>
            <div style={{ ...pill, background: "#d7ff52", color: "#14110f", border: "2px solid #d7ff52" }}>{total("questions")} questions</div>
            <div style={pill}>{total("papers")} papers</div>
            <div style={pill}>MST-1 · MST-2 · End Sem</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
