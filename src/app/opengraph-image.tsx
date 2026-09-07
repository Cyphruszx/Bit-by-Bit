import { ImageResponse } from "next/og";
import { siteName, siteTagline } from "@/lib/brand";

/**
 * The social card, drawn rather than committed as a binary.
 *
 * Colours are the resolved values of the semantic tokens in globals.css. They
 * cannot be read from CSS here — this renders outside the browser, with no
 * stylesheet — so when a primitive changes in that file, change it here too.
 */
const CANVAS = "#f2f3f5";
const INK = "#0a0a0a";
const MUTED = "#626976";
const LINE = "#dfe1e5";
const PRIMARY = "#1e2a78";
const SECONDARY = "#4a5bc4";
const ACCENT = "#0022ff";
const INFLOW = "#1155cc";
const OUTFLOW = "#bb1626";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${siteName} — ${siteTagline}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: CANVAS,
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", flexWrap: "wrap", width: 116, gap: 8 }}>
            <div style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: PRIMARY }} />
            <div style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: ACCENT }} />
            <div style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: SECONDARY }} />
            <div style={{ width: 54, height: 54, borderRadius: 6, backgroundColor: PRIMARY }} />
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>
            {siteName}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: ACCENT, letterSpacing: "-0.02em" }}>
            {siteTagline}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: MUTED, maxWidth: 820, lineHeight: 1.4 }}>
            Bank files, PDFs, spreadsheets and photos, read into money in, money out, and what that
            leaves.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, borderTop: `2px solid ${LINE}`, paddingTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 32, borderRadius: 2, backgroundColor: INFLOW }} />
            <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: INFLOW }}>Money in</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 32, borderRadius: 2, backgroundColor: OUTFLOW }} />
            <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: OUTFLOW }}>Money out</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
