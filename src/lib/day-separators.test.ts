import { describe, expect, it } from "vitest";
import { formatDayLabel, withDaySeparators } from "./day-separators";

describe("day separators", () => {
  it("inserts a Today label", () => {
    const now = Date.UTC(2026, 8, 6, 12, 0, 0);
    const rows = withDaySeparators(
      [{ eventId: "1", sentAt: now }, { eventId: "2", sentAt: now + 1000 }],
      now,
    );
    expect(rows[0]).toMatchObject({ kind: "separator", label: "Today" });
    expect(formatDayLabel(now - 86_400_000, now)).toBe("Yesterday");
  });
});
