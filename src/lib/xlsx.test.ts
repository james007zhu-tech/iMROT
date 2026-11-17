import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildXlsx } from "./xlsx";

describe("xlsx writer", () => {
  it("writes a zip whose sheet holds the numbers and the text", () => {
    const b = buildXlsx([{ name: "损益 P&L", rows: [["月份", "收入"], ["2026-11", 21400.5], ["A&B <x>", null]] }]);
    expect(b.subarray(0, 4).toString("hex")).toBe("504b0304");
    const at = b.indexOf(Buffer.from("xl/worksheets/sheet1.xml")); const size = b.readUInt32LE(at - 30 + 18);
    const xml = inflateRawSync(b.subarray(at + 24, at + 24 + size)).toString("utf8");
    expect(xml).toContain("<v>21400.5</v>"); expect(xml).toContain("月份"); expect(xml).toContain("A&amp;B &lt;x&gt;");
    expect(b.subarray(-22, -18).toString("hex")).toBe("504b0506");
  });
});
