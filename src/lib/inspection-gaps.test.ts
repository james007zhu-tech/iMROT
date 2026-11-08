import { describe, expect, it } from "vitest";
import { inspectionGaps } from "./inspection-gaps";

describe("INTH missing items", () => {
  it("lists what the wireframe example lacks", () => {
    const g = inspectionGaps({ conditions: "环境 38℃ 粉尘重；电网 372V", findings: "风扇 1 卡死", probableCause: "散热失效", recommendation: "更换风扇与电容组，带载测试 2 小时", instruments: "", tests: [{ test: "外观", result: "风扇卡死", recordId: "P1" }, { test: "功能测试", result: "20Hz 跳闸" }] });
    expect(g.map((x) => x.key)).toEqual(["gap_isolation", "gap_authorization", "gap_evidence", "gap_instruments"]);
    expect(g.find((x) => x.key === "gap_evidence")?.detail).toBe("功能测试");
  });
  it("is empty for a complete record", () => {
    expect(inspectionGaps({ conditions: "已断电挂牌，验电无电", findings: "x", probableCause: "y", recommendation: "更换风扇；需客户确认报价", instruments: "Fluke 87V", tests: [{ test: "供电", result: "372V", recordId: "M1" }] })).toEqual([]);
  });
});
