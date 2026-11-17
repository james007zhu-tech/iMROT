/**
 * Helpers for the probes. Two rules of 2026-11-17 stand in front of what most probes want to exercise — every quote
 * line carries a cost, every PO is approved by the MD — so the probes go through these wrappers, which do that step the
 * way a person would (a cost of 0 on the lines that have none; the MD's approval) and then call the real function.
 * The rules themselves are probed in probe-dispatch-v2.ts with the real functions.
 */
import { prisma } from "../../src/lib/db";
import { setQuoteLines as realSetQuoteLines } from "../../src/server/slm-docs";
import { askPoApproval, decidePurchaseOrder, receivePurchaseOrder as realReceive } from "../../src/server/purchasing";
import { dispatchToPartner as realDispatch } from "../../src/server/srm";

export const setQuoteLines: typeof realSetQuoteLines = async (input) => {
  try { return await realSetQuoteLines(input); }
  catch (e) {
    const m = /^QUOTE_COST_REQUIRED:(.+)$/.exec((e as Error).message);
    if (!m) throw e;
    const missing = m[1].split("、").map(Number); // the lines a person would be asked for: the probe answers 0 (no cost on this line)
    return realSetQuoteLines({ ...input, lines: input.lines.map((l, i) => (missing.includes(i + 1) ? { ...l, unitCost: 0 } : l)) });
  }
};

export async function approvePo(no: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no } });
  if (po.approvedAt || po.status !== "DRAFT") { if (!po.approvedAt) await prisma.purchaseOrder.update({ where: { no }, data: { approvedAt: new Date(), approvedBy: "probe" } }); return; }
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  if (!po.approvalAskedAt) await askPoApproval({ no, actorCode: md.code });
  await decidePurchaseOrder({ no, actorCode: md.code, approve: true });
}
export const receivePurchaseOrder: typeof realReceive = async (input) => { await approvePo(input.poNo); return realReceive(input); };
export const dispatchToPartner: typeof realDispatch = async (input) => { await approvePo(input.poNo); return realDispatch(input); };
