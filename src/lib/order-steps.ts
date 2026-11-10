/**
 * What an order needs next, and which report each document produces. Pure, shared by the order page and tests.
 * Report names are shown to people; template numbers (04…19) stay internal.
 */
export type StepKey = "assign" | "inspect" | "quote" | "confirm" | "decline" | "receive" | "repair" | "maintain" | "stockOut" | "deliver" | "accept" | "invoice" | "payment" | "archive" | "contractDirect" | "partner" | "ship" | "plan" | "project";

export interface OrderShape {
  status: string; kind: string;
  hasInspection: boolean; hasQuote: boolean; hasJob: boolean; jobFinished: boolean; workshop: boolean;
  deliveriesSigned: number; deliveriesOpen: number; invoicesUnpaid: number; hasAcceptance: boolean;
  partner?: boolean; /// 合作维修: a partner repairs it — the partner page replaces the RPTH step
  trade?: boolean; /// 贸易: no machine — quote, customer PO, stock out, DNTH; the signed DNTH stands in for acceptance
  stockOuts?: number; /// OBTH lines issued against the order
  project?: { planned: boolean; invoiceDue: number }; /// 自动化项目: plan saved? done instalments not yet invoiced
  intl?: boolean; /// 国际贸易: after the OBTH comes the shipment (CI + PL), then the B/L — no customer signature, no TITH
  declineOpen?: string[]; /// 客户拒绝报价: what still blocks closing (declineCloseBlockers) — present only on a declined order
}

const MAINT = new Set(["MAINTENANCE", "CONTRACT"]);

export function stepHref(no: string, s: StepKey): string {
  return s === "stockOut" ? `/parts/movement?direction=OUT&order=${no}` : `/service-orders/${no}/${s}`;
}

/** The one thing to do next (shown as the blue button), plus what else makes sense in this status. */
export function nextSteps(o: OrderShape): { primary: StepKey | null; also: StepKey[] } {
  if (o.declineOpen) {
    // 客户拒绝报价 (2026-11-09): machine back on a DNTH, inspection fee on a TITH → IVTH → payment, then close by hand
    const ret = o.declineOpen.includes("RETURN_DNTH"), fee = o.declineOpen.includes("FEE_TITH");
    if (o.status === "DECLINED") return ret ? { primary: "deliver", also: fee ? ["invoice"] : [] } : fee ? { primary: "invoice", also: [] } : { primary: null, also: ["archive"] };
    if (o.status === "INVOICED") return { primary: o.invoicesUnpaid > 0 ? "payment" : ret ? "deliver" : "archive", also: ret && o.invoicesUnpaid > 0 ? ["deliver"] : ["archive"] };
    if (o.status === "CLOSED") return { primary: null, also: ["archive"] };
  }
  if (o.project) {
    // 自动化项目 (2026-11-09): plan (solution, BOM, split) → quote → PO → milestones on the project page (FAT, DNTH, SAT
    // locks) with an instalment TITH + IVTH at each paying milestone → payment
    const p = o.project;
    switch (o.status) {
      case "RECEIVED": case "ASSIGNED": case "DIAGNOSING": return p.planned ? { primary: "quote", also: ["plan"] } : { primary: "plan", also: [] };
      case "QUOTE_PENDING": return { primary: "confirm", also: ["quote", "plan"] };
      case "IN_PROGRESS": case "ACCEPTANCE_PENDING": return { primary: "project", also: ["deliver", "stockOut", ...(o.invoicesUnpaid ? (["payment"] as StepKey[]) : []), "plan"] };
      case "ACCEPTED": case "INVOICED": return p.invoiceDue ? { primary: "project", also: o.invoicesUnpaid ? ["payment"] : [] } : o.invoicesUnpaid ? { primary: "payment", also: ["project"] } : { primary: "archive", also: ["project"] };
      default: break;
    }
  }
  if (o.trade && o.intl) {
    // 国际贸易 (2026-11-09): quote → customer PO → OBTH → shipment (CI IVTH + PL DNTH) → B/L → INVOICED → payment
    switch (o.status) {
      case "RECEIVED": case "ASSIGNED": case "DIAGNOSING": return { primary: "quote", also: [] };
      case "QUOTE_PENDING": return { primary: "confirm", also: ["quote"] };
      case "IN_PROGRESS": case "ACCEPTANCE_PENDING": return o.stockOuts || o.deliveriesOpen ? { primary: "ship", also: [...(o.invoicesUnpaid ? (["payment"] as StepKey[]) : []), "stockOut"] } : { primary: "stockOut", also: ["ship"] };
      case "ACCEPTED": case "INVOICED": return { primary: o.invoicesUnpaid > 0 ? "payment" : "archive", also: o.invoicesUnpaid > 0 ? ["ship", "archive"] : ["ship"] };
      default: break;
    }
  }
  if (o.trade) {
    // 贸易 (2026-11-09): quote → customer PO → OBTH → DNTH; signing the DNTH accepts and locks the order (delivery.ts)
    switch (o.status) {
      case "RECEIVED": case "ASSIGNED": case "DIAGNOSING": return { primary: "quote", also: [] };
      case "QUOTE_PENDING": return { primary: "confirm", also: ["quote"] };
      case "IN_PROGRESS": return o.stockOuts ? { primary: "deliver", also: ["stockOut"] } : { primary: "stockOut", also: ["deliver"] };
      case "ACCEPTANCE_PENDING": return { primary: "deliver", also: ["stockOut"] };
      default: break; // ACCEPTED onwards: invoice, payment, archive as for every order
    }
  }
  if (o.partner) {
    // 合作维修 (flow 2026-11-08): partner PRTH → quote → customer PO → POTH → 外送 → track → 取回 → retest → DNTH → acceptance
    switch (o.status) {
      case "DIAGNOSING": return { primary: "partner", also: ["quote", "inspect", "receive"] };
      case "QUOTE_PENDING": return { primary: "confirm", also: ["decline", "quote", "partner"] };
      case "IN_PROGRESS": return { primary: "partner", also: ["receive"] };
      case "ACCEPTANCE_PENDING": return o.deliveriesSigned === 0 ? { primary: "deliver", also: ["accept", "partner"] } : { primary: "accept", also: ["deliver", "partner"] };
      default: break;
    }
  }
  const work: StepKey = MAINT.has(o.kind) ? "maintain" : "repair";
  switch (o.status) {
    // In-contract maintenance needs no quote: the PMTH form itself moves the order on.
    // Paid maintenance is quoted first, then done on a PMTH; repairs are inspected first.
    case "ASSIGNED": return o.kind === "CONTRACT" ? { primary: "maintain", also: ["inspect", "receive"] } : o.kind === "MAINTENANCE" ? { primary: "quote", also: ["inspect", "receive"] } : { primary: "inspect", also: ["receive"] };
    case "RECEIVED": return { primary: "assign", also: o.kind === "CONTRACT" ? [] : ["inspect", "quote"] };
    case "DIAGNOSING": return o.kind === "CONTRACT" ? { primary: "maintain", also: ["contractDirect", "inspect", "quote"] } : { primary: "quote", also: ["inspect", "receive"] };
    case "QUOTE_PENDING": return { primary: "confirm", also: ["decline", "quote"] };
    case "IN_PROGRESS": return { primary: work, also: ["receive", "stockOut", "inspect", ...(o.workshop ? (["deliver"] as StepKey[]) : [])] };
    case "ACCEPTANCE_PENDING": {
      const needDelivery = o.workshop && o.deliveriesSigned === 0;
      return { primary: needDelivery ? "deliver" : "accept", also: needDelivery ? ["accept", work] : o.workshop ? ["deliver", work] : [work] };
    }
    case "ACCEPTED": return { primary: "invoice", also: ["archive", "deliver"] };
    case "INVOICED": return { primary: o.invoicesUnpaid > 0 ? "payment" : "archive", also: ["archive"] };
    case "CLOSED": return { primary: null, also: ["archive"] };
    default: return { primary: null, also: [] };
  }
}

/** Report(s) a registered document renders to: template code + message key of its name. */
export function reportsFor(doc: { type: string; templateCode: string | null }, hasAcceptance: boolean, hasQuote = true): { template?: string; key: string }[] {
  switch (doc.type) {
    case "QT": if (doc.templateCode === "30" || doc.templateCode === "31") return [{ template: "30", key: "rpt30" }, { template: "31", key: "rpt31" }]; // 贸易: quotation + order confirmation
      return !hasQuote ? (hasAcceptance ? [{ template: "12", key: "rpt12" }, { template: "13", key: "rpt13" }] : []) : [{ template: "04", key: "rpt04" }, { template: "06", key: "rpt06" }, ...(hasAcceptance ? [{ template: "12", key: "rpt12" }, { template: "13", key: "rpt13" }] : [])];
    case "IN": return [{ key: "rpt08" }];
    case "RP": return [{ key: doc.templateCode === "10" ? "rpt10" : "rpt09" }];
    case "PM": return [{ key: "rpt11" }];
    case "ER": return [{ key: "rpt07" }];
    case "DN": return [{ key: doc.templateCode === "34" ? "rpt34" : "rpt19" }]; // 国际贸易: the shipment's packing list

    case "TI": return [{ key: "rpt20" }];
    case "IV": return [{ key: doc.templateCode === "33" ? "rpt33" : "rpt21" }]; // 国际贸易: the commercial invoice
    case "RC": return [{ key: "rpt22" }];
    case "BL": return [{ key: "rpt23" }];
    case "PR": return [{ key: "rpt24" }];
    case "PO": return [{ key: "rpt25" }];
    case "IB": return [{ key: doc.templateCode === "29" ? "rpt29" : "rpt26" }];
    case "OB": return [{ key: doc.templateCode === "28" ? "rpt28" : "rpt27" }];
    default: return [];
  }
}
