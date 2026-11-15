/**
 * 维修 / 维保 may only be written when the order has reached the work (测试报告 P0-07, P0-08). One rule for the page
 * and the service, so a URL typed by hand meets the same wall as the button.
 */
export type WorkGap = "inspect" | "quote" | "confirm" | "over";

/** What still has to happen before work may be recorded on this order; null = go ahead. */
export function workGap(o: { status: string; kind: string }, opts: { maintenance: boolean; rework?: boolean }): WorkGap | null {
  if (o.status === "IN_PROGRESS" || o.status === "ACCEPTANCE_PENDING") return null;
  // in-contract maintenance needs no quote: the visit itself is the order
  if (opts.maintenance && o.kind === "CONTRACT" && ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING"].includes(o.status)) return null;
  // the customer rejected the acceptance: the order is back at diagnosis and the rework is recorded on a new report
  if (opts.rework && (o.status === "DIAGNOSING" || o.status === "ASSIGNED")) return null;
  if (o.status === "RECEIVED" || o.status === "ASSIGNED") return opts.maintenance ? "quote" : "inspect";
  if (o.status === "DIAGNOSING") return "quote";
  if (o.status === "QUOTE_PENDING") return "confirm";
  return "over";
}

/** The run tests of which at least one must be done, with a result, and passed before a repair goes to acceptance. */
export const RUN_TESTS = ["electrical", "noLoad", "load"];
export type TestLine = { key?: string; test?: string; result?: string | null; pass?: boolean | null };

/** Why a repair cannot be finished yet: FAILED (a test did not pass) or NEEDS_TEST (no run test with a result that passed). */
export function finishGap(tests: TestLine[] | null | undefined): "FAILED" | "NEEDS_TEST" | null {
  const rows = tests ?? [];
  if (rows.some((t) => t.pass === false)) return "FAILED";
  const done = rows.filter((t) => (t.key ? RUN_TESTS.includes(t.key) : true) && !!t.result?.trim() && t.pass === true);
  return done.length ? null : "NEEDS_TEST";
}
