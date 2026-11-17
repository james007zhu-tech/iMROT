import { describe, expect, it } from "vitest";
import { can, hasRole, isApprover, menuAllows, menuOwners, pathAllows, pathOwners, rolesOf, scoped, noOrders, stripMoney } from "./caps";

describe("六角色权限表 (朱总 2026-11-16 16:31)", () => {
  it("ENG and HR never see price, cost, margin or the company's bank; PUR sees purchase cost only", () => {
    for (const r of ["ENGINEER", "HR"]) for (const c of [can.price, can.cost, can.margin, can.bank, can.invoice, can.editPrice]) expect(c(r)).toBe(false);
    expect(can.cost("PURCHASING")).toBe(true);
    for (const c of [can.price, can.margin, can.bank, can.invoice, can.pay]) expect(c("PURCHASING")).toBe(false);
  });
  it("Sales quotes and follows the money, but never issues an invoice or pays; FIN does not change quotes", () => {
    expect(can.editPrice("SALES") && can.margin("SALES") && can.invoiceStatus("SALES")).toBe(true);
    expect(can.invoice("SALES") || can.finance("SALES") || can.bank("SALES") || can.purchase("SALES")).toBe(false);
    expect(can.invoice("FINANCE") && can.bank("FINANCE") && can.price("FINANCE")).toBe(true);
    expect(can.editPrice("FINANCE") || can.staff("FINANCE") || can.purchase("FINANCE")).toBe(false);
  });
  it("several roles add up; the old roles map onto the six", () => {
    const both = { role: "SALES", extraRoles: ["PURCHASING"] };
    expect(can.editPrice(both) && can.purchase(both)).toBe(true);
    expect(menuAllows(both, "customers") && menuAllows(both, "suppliers")).toBe(true);
    expect(rolesOf("ADMIN")).toEqual(["SALES"]); expect(rolesOf("WAREHOUSE")).toEqual(["PURCHASING"]); expect(rolesOf("MANAGER")).toEqual(["ENGINEER"]);
    expect(hasRole({ role: "ENGINEER", extraRoles: ["HR"] }, "HR")).toBe(true);
  });
  it("主管 is an engineer who approves: same money as any engineer", () => {
    const lead = { role: "ENGINEER", approver: true };
    expect(isApprover(lead) && can.team(lead)).toBe(true); expect(isApprover({ role: "ENGINEER" })).toBe(false); expect(isApprover("MD")).toBe(true);
    for (const c of [can.price, can.cost, can.margin, can.bank, can.pay]) expect(c(lead)).toBe(false);
    expect(scoped(lead)).toBe(true); expect(noOrders("HR")).toBe(true); expect(scoped("PURCHASING")).toBe(false);
  });
  it("menus and pages by role, and whose a page is", () => {
    expect(menuAllows("HR", "payroll")).toBe(true); expect(menuAllows("HR", "customers") || menuAllows("HR", "ledger") || menuAllows("HR", "opportunities")).toBe(false);
    expect(menuAllows("ENGINEER", "finReports") || menuAllows("SALES", "ledger") || menuAllows("PURCHASING", "customers")).toBe(false);
    expect(menuAllows("MD", "permissions")).toBe(true);
    expect(pathAllows("SALES", "/customers/new")).toBe(true); expect(pathAllows("FINANCE", "/customers/new") || pathAllows("ENGINEER", "/customers/new")).toBe(false);
    expect(pathAllows("PURCHASING", "/purchasing/orders/new")).toBe(true); expect(pathAllows("SALES", "/purchasing/orders/new")).toBe(false);
    expect(pathAllows("HR", "/finance/expenses")).toBe(true); expect(pathAllows("HR", "/finance/payables")).toBe(false);
    expect(menuOwners("payroll")).toContain("HR"); expect(pathOwners("/finance/payables")).toEqual(["FINANCE"]); expect(pathOwners("/purchasing/orders/new")).toEqual(["PURCHASING"]);
  });
  it("strips money by field name at any depth", () => {
    const order = { no: "QTTH1", total: 100, customer: { code: "CTH1", name: "TEST Customer Co." }, quoteLines: [{ description: "x", qty: 1, unitPrice: 100, unitCost: 60, part: { sku: "P1", lastCost: 55 } }], marginPct: 40, entity: { bankAccounts: [{ accountNo: "1" }] } };
    const eng = stripMoney(order, "ENGINEER") as Record<string, unknown>;
    expect(JSON.stringify(eng)).not.toMatch(/100|60|55|40|accountNo/); expect((eng.quoteLines as unknown[]).length).toBe(1); expect(JSON.stringify(eng)).toMatch(/TEST Customer/);
    // PUR: what we paid for a part, never the customer's price, the quote's cost and margin, or who the customer is
    const pur = JSON.stringify(stripMoney(order, "PURCHASING"));
    expect(pur).toMatch(/lastCost/); expect(pur).not.toMatch(/unitPrice|unitCost|marginPct|total|accountNo|TEST Customer/); expect(pur).toMatch(/CTH1/);
    // Sales: price, the cost written on the quote and its margin — never what we paid (MD 2026-11-17)
    const sal = JSON.stringify(stripMoney(order, "SALES"));
    expect(sal).toMatch(/unitPrice/); expect(sal).toMatch(/unitCost/); expect(sal).toMatch(/marginPct/); expect(sal).not.toMatch(/lastCost|accountNo/);
    expect(can.cost("SALES")).toBe(false); expect(JSON.stringify(stripMoney(order, "HR"))).not.toMatch(/TEST Customer/);
    expect(stripMoney(order, "MD")).toBe(order);
  });
});
