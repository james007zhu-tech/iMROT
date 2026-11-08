import { describe, expect, it } from "vitest";
import { reportFileLabel, reportFileName } from "./report-name";

describe("report download names", () => {
  it("differ per report under one QTTH", () => {
    const names = ["报价建议书", "订单确认", "服务完成确认", "客户验收单"].map((l) => reportFileName("QTTH261108004", l, ".pdf"));
    expect(new Set(names).size).toBe(4);
    expect(names[0]).toBe("QTTH261108004_报价建议书.pdf");
  });
  it("drop the number prefix and notes from menu labels", () => {
    expect(reportFileLabel("税务发票 TITH（正本 + 副本）")).toBe("税务发票");
    expect(reportFileLabel("Receipt RCTH (original + copy)")).toBe("Receipt");
    expect(reportFileName("IVTH26110801", "请款单 IVTH", ".docx")).toBe("IVTH26110801_请款单.docx");
  });
  it("never produce path characters", () => {
    expect(reportFileName("QTTH1", "A/B", ".pdf")).toBe("QTTH1_A-B.pdf");
  });
});
