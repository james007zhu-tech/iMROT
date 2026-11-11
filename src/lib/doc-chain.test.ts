import { describe, expect, it } from "vitest";
import { CHAINS, chainOf } from "./doc-chain";

describe("单据链", () => {
  it("every mode starts at the QTTH and ends at the receipt", () => {
    for (const steps of Object.values(CHAINS)) { expect(steps[0].key).toBe("QT"); expect(steps.at(-1)!.key).toBe("RC"); }
  });
  it("export orders carry no tax invoice", () => {
    expect(CHAINS.INTERNATIONAL_TRADE.some((x) => x.key === "TI")).toBe(false);
  });
  it("marks the first required empty step as next, skipping optional ones", () => {
    const c = chainOf("REPAIR", [{ no: "QTTH1", type: "QT" }]);
    expect(c.find((x) => x.next)!.key).toBe("IN"); // ERTH is optional (on-site repair)
    expect(c.filter((x) => x.next)).toHaveLength(1);
  });
  it("places the customer PO and the acceptance, which have no number of ours", () => {
    const c = chainOf("REPAIR", [{ no: "QTTH1", type: "QT" }, { no: "INTH1", type: "IN" }, { no: "RPTH1", type: "RP" }], { customerPo: "PO-778", acceptance: "2026-11-10" });
    expect(c.find((x) => x.key === "CPO")!.docs[0].no).toBe("PO-778");
    expect(c.find((x) => x.key === "AC")!.done).toBe(true);
    expect(c.find((x) => x.next)!.key).toBe("TI");
  });
  it("keeps several documents of one type together", () => {
    const c = chainOf("DOMESTIC_TRADE", [{ no: "DN1", type: "DN" }, { no: "DN2", type: "DN" }]);
    expect(c.find((x) => x.key === "DN")!.docs).toHaveLength(2);
  });
});
