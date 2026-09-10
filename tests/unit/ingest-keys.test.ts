import { describe, expect, it } from "vitest";
import { deriveDisplayName, deriveLogicalKey, mimeTypeFor } from "@/lib/pipeline/ingest";

describe("logical keys", () => {
  it("extracts the report identifier from fixture-style filenames", () => {
    expect(deriveLogicalKey("OPS-2026-004-v2-northstar-operational-review-corrected.pdf")).toBe("OPS-2026-004");
    expect(deriveLogicalKey("copy-of-AUD-2026-011-v1-meridian-water-audit-report.pdf")).toBe("AUD-2026-011");
    expect(deriveLogicalKey("inc-2026-012-v1-granite-peak.docx")).toBe("INC-2026-012");
  });
  it("falls back to a slug for arbitrary names", () => {
    expect(deriveLogicalKey("Board Minutes (final).pdf")).toBe("BOARD-MINUTES-FINAL");
    expect(deriveLogicalKey("quarterly report v3 draft.docx")).toBe("QUARTERLY-REPORT");
  });
  it("derives display names and mime types", () => {
    expect(deriveDisplayName("copy-of-AUD-2026-011-v1-meridian-water.pdf")).toBe("AUD 2026 011 meridian water");
    expect(mimeTypeFor("a.PDF")).toBe("application/pdf");
    expect(mimeTypeFor("a.docx")).toContain("wordprocessingml");
    expect(mimeTypeFor("a.txt")).toBeNull();
  });
});
