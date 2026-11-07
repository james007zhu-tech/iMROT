/**
 * What an order needs next, and which report each document produces. Pure, shared by the order page and tests.
 * Report names are shown to people; template numbers (04…19) stay internal.
 */
export type StepKey = "assign" | "inspect" | "quote" | "confirm" | "receive" | "repair" | "maintain" | "stockOut" | "deliver" | "accept" | "invoice" | "payment" | "archive" | "contractDirect";

export interface OrderShape {
  status: string; kind: string;
  hasInspection: boolean; hasQuote: boolean; hasJob: boolean; jobFinished: boolean; workshop: boolean;
  deliveriesSigned: number; deliveriesOpen: number; invoicesUnpaid: number; hasAcceptance: boolean;
}

const MAINT = new Set(["MAINTENANCE", "CONTRACT"]);

export function stepHref(no: string, s: StepKey): string {
  return s === "stockOut" ? `/parts/movement?direction=OUT&order=${no}` : `/service-orders/${no}/${s}`;
}

/** The one thing to do next (shown as the blue button), plus what else makes sense in this status. */
export function nextSteps(o: OrderShape): { primary: StepKey | null; also: StepKey[] } {
  const work: StepKey = MAINT.has(o.kind) ? "maintain" : "repair";
  switch (o.status) {
    // In-contract maintenance needs no quote: the PMTH form itself moves the order on.
    // Paid maintenance is quoted first, then done on a PMTH; repairs are inspected first.
    case "ASSIGNED": return o.kind === "CONTRACT" ? { primary: "maintain", also: ["inspect", "receive"] } : o.kind === "MAINTENANCE" ? { primary: "quote", also: ["inspect", "receive"] } : { primary: "inspect", also: ["receive"] };
    case "RECEIVED": return { primary: "assign", also: o.kind === "CONTRACT" ? [] : ["inspect", "quote"] };
    case "DIAGNOSING": return o.kind === "CONTRACT" ? { primary: "maintain", also: ["contractDirect", "inspect", "quote"] } : { primary: "quote", also: ["inspect", "receive"] };
    case "QUOTE_PENDING": return { primary: "confirm", also: ["quote"] };
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
    case "QT": return !hasQuote ? (hasAcceptance ? [{ template: "12", key: "rpt12" }, { template: "13", key: "rpt13" }] : []) : [{ template: "04", key: "rpt04" }, { template: "06", key: "rpt06" }, ...(hasAcceptance ? [{ template: "12", key: "rpt12" }, { template: "13", key: "rpt13" }] : [])];
    case "IN": return [{ key: "rpt08" }];
    case "RP": return [{ key: doc.templateCode === "10" ? "rpt10" : "rpt09" }];
    case "PM": return [{ key: "rpt11" }];
    case "ER": return [{ key: "rpt07" }];
    case "DN": return [{ key: "rpt19" }];
    default: return [];
  }
}
