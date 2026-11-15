import { describe, expect, it } from "vitest";
import { parsePower, powerLabel } from "./power";

describe("rated power of a double-axis module", () => {
  it("reads 2x4.0 kW as two axes of 4 kW", () => {
    expect(parsePower("2x4.0 kW")).toEqual({ kw: 4, axes: 2 });
    expect(parsePower("2 × 4")).toEqual({ kw: 4, axes: 2 });
    expect(parsePower("2*1,5")).toEqual({ kw: 1.5, axes: 2 });
    expect(parsePower("7.5")).toEqual({ kw: 7.5 });
    expect(parsePower("")).toEqual({});
    expect(parsePower("abc")).toEqual({});
  });
  it("writes it back the same way", () => {
    expect(powerLabel(4, 2)).toBe("2×4 kW");
    expect(powerLabel("4.00", 2)).toBe("2×4 kW");
    expect(powerLabel(7.5, null)).toBe("7.5 kW");
    expect(powerLabel(null)).toBe("—");
  });
});
