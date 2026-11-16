import { describe, expect, it } from "vitest";
import { can, menuAllows, pathAllows, stripMoney } from "./caps";

describe("统一角色权限表", () => {
  it("the shop floor sees no price, cost, bank; 主管 exactly as the engineer", () => {
    for (const r of ["ENGINEER", "MANAGER", "WAREHOUSE"]) { expect(can.price(r)).toBe(false); expect(can.cost(r)).toBe(false); expect(can.bank(r)).toBe(false); expect(can.invoice(r)).toBe(false); expect(can.editPrice(r)).toBe(false); }
  });
  it("内勤 sees the price and cannot change it; sales sets it; finance issues", () => {
    expect(can.price("ADMIN")).toBe(true); expect(can.editPrice("ADMIN")).toBe(false); expect(can.cost("ADMIN")).toBe(false);
    expect(can.editPrice("SALES")).toBe(true); expect(can.invoice("SALES")).toBe(false); expect(can.invoice("FINANCE")).toBe(true);
  });
  it("HR keeps staff and pay, nothing of sales or the bank", () => {
    expect(can.staff("HR")).toBe(true); expect(can.price("HR")).toBe(false); expect(can.bank("HR")).toBe(false); expect(menuAllows("HR", "customers")).toBe(false); expect(menuAllows("HR", "payroll")).toBe(true);
  });
  it("menus and pages by role", () => {
    expect(menuAllows("ENGINEER", "ledger")).toBe(false); expect(menuAllows("ENGINEER", "entities")).toBe(false); expect(menuAllows("ENGINEER", "stock")).toBe(true);
    expect(menuAllows("MANAGER", "finReports")).toBe(false); expect(menuAllows("FINANCE", "finReports")).toBe(true); expect(menuAllows("MD", "permissions")).toBe(true);
    expect(pathAllows("ENGINEER", "/admin")).toBe(false); expect(pathAllows("FINANCE", "/admin")).toBe(true); expect(pathAllows("FINANCE", "/admin/permissions")).toBe(false);
    expect(pathAllows("ENGINEER", "/finance/payables")).toBe(false); expect(pathAllows("ENGINEER", "/finance/expenses/new")).toBe(true);
    expect(pathAllows("ENGINEER", "/service-orders/QTTH1/invoice")).toBe(false); expect(pathAllows("SALES", "/service-orders/QTTH1/invoice")).toBe(true);
    expect(pathAllows("ENGINEER", "/customers/new")).toBe(false); expect(pathAllows("ADMIN", "/customers/new")).toBe(true);
  });
  it("stripMoney drops the figures by name at any depth", () => {
    const order = { no: "QTTH1", total: 100, costTotal: 60, marginPct: 0.4, lines: [{ description: "x", qty: 1, unitPrice: 100, unitCost: 60 }], events: [{ type: "QUOTED", summary: "THB 100", payload: { total: 100 } }, { type: "INSPECTED", summary: "fan" }] };
    const eng = stripMoney(order, "ENGINEER") as Record<string, unknown>;
    expect(JSON.stringify(eng)).not.toMatch(/100|60|0\.4/); expect((eng.events as { summary?: string }[])[1].summary).toBe("fan");
    const adm = stripMoney(order, "ADMIN");
    expect(adm.total).toBe(100); expect("costTotal" in adm).toBe(false); expect("unitCost" in adm.lines[0]).toBe(false);
    expect(stripMoney(order, "MD")).toBe(order);
  });
});
