import { describe, expect, it } from "vitest";
import { ageBand, ageRange } from "./asset-board";

const now = new Date("2026-11-11T00:00:00Z");
describe("设备年限", () => {
  it("bands by years since installation", () => {
    expect(ageBand(new Date("2025-01-01"), now)).toBe("lt3");
    expect(ageBand(new Date("2022-06-01"), now)).toBe("3to5");
    expect(ageBand(new Date("2018-01-01"), now)).toBe("5to10");
    expect(ageBand(new Date("2010-01-01"), now)).toBe("gt10");
    expect(ageBand(null, now)).toBe("unknown");
  });
  it("the filter window puts an asset in the band it was counted in", () => {
    for (const d of ["2025-01-01", "2022-06-01", "2018-01-01", "2010-01-01"]) {
      const at = new Date(d), r = ageRange(ageBand(at, now), now)!;
      expect((!r.gte || at >= r.gte) && (!r.lt || at < r.lt)).toBe(true);
    }
    expect(ageRange("unknown", now)).toBeNull();
    expect(ageRange("", now)).toBeUndefined();
  });
});
