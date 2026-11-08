import { describe, expect, it } from "vitest";
import { findCodes, parseNewAsset } from "./assist-parse";

describe("offline assistant parsing", () => {
  it("finds record numbers by kind", () => {
    const c = findCodes("ATH26110002 的维修历史？还有 QTTH26110504 和 inth26110502，客户 CTH2611002");
    expect(c.assets).toEqual(["ATH26110002"]);
    expect(c.docs).toEqual(["QTTH26110504", "INTH26110502"]);
    expect(c.customers).toEqual(["CTH2611002"]);
  });
  it("reads a dictated new asset (trial 2026-11-05 wording)", () => {
    expect(parseNewAsset("新建设备 变频器 序列号 GRK-V-009 位置 Line 3")).toEqual({ type: "VFD", serialNumber: "GRK-V-009", location: "Line 3" });
    expect(parseNewAsset("new asset motor serial M-77 location Press 2")).toEqual({ type: "MOTOR", serialNumber: "M-77", location: "Press 2" });
    expect(parseNewAsset("ATH26110002 的维修历史")).toBeNull();
  });
});
