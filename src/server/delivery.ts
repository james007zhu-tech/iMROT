/**
 * DNTH — delivery note. What goes back to the customer must match their PO line by line, and everything that came in
 * on an ERTH (accessories) or was marked "return to customer" on an RPTH (old parts) must go back too.
 * A mismatch blocks issuing unless the MD approves with a reason; every override is audited.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { partnerDeliveryBlockers } from "@/server/srm";
import { allocateNumber } from "@/lib/numbering-db";
import { audit } from "@/server/audit";
import { findPart, normPartNo, recordStockDoc, stockOnHand } from "@/server/scm";
import { poLinesFromQuote, progressOrder, type PoLine } from "@/server/slm";
import { isTradeMode } from "@/lib/modes";
import { RETURN_UNREPAIRED, returnRemark } from "@/lib/decline";

export type DeliveryLine = { key: string; kind: "PO" | "RETURN" | "MACHINE"; poLineNo?: number; description: string; assetCode?: string; partSku?: string; expected: number; deliveredBefore: number; source?: string; isService?: boolean };

/** What this order still has to deliver, computed from the PO, earlier DNTHs, ERTH accessories and RPTH old parts.
 *  A declined order (客户拒绝报价) delivers no PO: each machine an ERTH took in goes back unrepaired, with its accessories. */
export async function deliveryPlan(no: string): Promise<{ lines: DeliveryLine[]; poFromQuote: boolean }> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({
    where: { no },
    include: { deliveries: true, decline: { select: { id: true } }, events: { where: { type: "RECEIVED_WORKSHOP" }, include: { asset: { select: { code: true } } } }, repairJobs: { include: { asset: { select: { code: true } } } }, assets: { include: { asset: true } } },
  });
  const stored = o.poLines as PoLine[] | null;
  const po = o.decline ? [] : stored?.length ? stored : await poLinesFromQuote(no);
  const before = new Map<string, number>();
  // A draft reserves a DNTH number but nothing has gone out yet.
  for (const d of o.deliveries.filter((x) => x.status !== "DRAFT")) for (const l of d.lines as { key: string; delivered: number }[]) before.set(l.key, (before.get(l.key) ?? 0) + Number(l.delivered || 0));
  const lines: DeliveryLine[] = po.map((l) => ({ key: `PO:${l.lineNo}`, kind: "PO", poLineNo: l.lineNo, description: l.description, assetCode: l.assetCode, partSku: l.partSku, expected: l.isService ? 0 : l.qty, deliveredBefore: before.get(`PO:${l.lineNo}`) ?? 0, isService: l.isService }));
  if (o.decline) {
    const inShop = [...new Set(o.events.map((e) => e.asset.code))];
    for (const code of inShop) lines.push({ key: `AS:${code}`, kind: "MACHINE", description: RETURN_UNREPAIRED, assetCode: code, expected: 1, deliveredBefore: before.get(`AS:${code}`) ?? 0 });
  }
  for (const e of o.events) {
    const list = ((e.payload as { accessoryList?: { item: string; qty: number }[] } | null)?.accessoryList) ?? [];
    list.forEach((a, i) => lines.push({ key: `ER:${e.sourceDocNo}:${i}`, kind: "RETURN", description: a.item, assetCode: e.asset.code, expected: a.qty, deliveredBefore: before.get(`ER:${e.sourceDocNo}:${i}`) ?? 0, source: e.sourceDocNo ?? undefined }));
  }
  for (const j of o.decline ? [] : o.repairJobs) {
    ((j.partsReplaced as { partSku: string; name?: string; qty: number; oldDisposition?: string; oldSerial?: string }[] | null) ?? []).forEach((p, i) => {
      if (p.oldDisposition === "RETURN_TO_CUSTOMER") lines.push({ key: `RP:${j.no}:${i}`, kind: "RETURN", description: `${p.name ?? p.partSku}${p.oldSerial ? ` S/N ${p.oldSerial}` : ""}`, assetCode: j.asset.code, partSku: p.partSku, expected: p.qty, deliveredBefore: before.get(`RP:${j.no}:${i}`) ?? 0, source: j.no });
    });
  }
  return { lines, poFromQuote: !stored?.length };
}

type OrderPart = { id: string; sku: string; vendorPartNo: string | null };
const bare = (x: string) => normPartNo(x).replace(/[^A-Z0-9]/g, "");

/**
 * Which library part each goods line of a trade order is (trial finding 2026-11-14, second round: the customer's PO was
 * read in before the part existed, the line carried no part number, and the stock check skipped it). In this order:
 * the line's own number; a POTH line of this order with the same number or text; a part number written inside the
 * description; a part received for this order whose number the description contains; and when exactly one line and one
 * received part are left over, each other. A line that still has no part is reported, never skipped.
 */
async function tradeParts(orderId: string, plan: DeliveryLine[]) {
  const goods = plan.filter((l) => l.kind === "PO" && !l.isService);
  const map = new Map<string, OrderPart>();
  const pos = await prisma.purchaseOrder.findMany({ where: { serviceOrderId: orderId, kind: "PARTS", status: { not: "CANCELLED" } }, select: { lines: true } });
  const bought = pos.flatMap((p) => p.lines as { partSku?: string; vendorPartNo?: string; description?: string }[]);
  const inbound = await prisma.stockMovement.findMany({ where: { serviceOrderId: orderId, direction: "IN", partId: { not: null } }, select: { part: { select: { id: true, sku: true, vendorPartNo: true } } } });
  const received = [...new Map(inbound.map((m) => [m.part!.id, m.part!])).values()];
  for (const l of goods) {
    let part: OrderPart | null = await findPart(l.partSku);
    const text = bare(l.description);
    if (!part) {
      const hit = bought.find((b) => { const n = bare(b.partSku || b.vendorPartNo || ""); return (n.length >= 4 && text.includes(n)) || (!!b.description && bare(b.description) === text); });
      if (hit) part = await findPart(hit.partSku || hit.vendorPartNo);
    }
    if (!part) {
      const hits = new Map<string, OrderPart>();
      for (const tok of l.description.split(/[\s,;，；()（）]+/).filter((t) => t.length >= 5 && /\d/.test(t))) { const p = await findPart(tok); if (p) hits.set(p.id, p); }
      if (hits.size === 1) part = [...hits.values()][0];
    }
    if (!part) part = received.find((r) => { const n = bare(r.vendorPartNo || r.sku); return n.length >= 4 && text.includes(n); }) ?? null;
    if (part) map.set(l.key, part);
  }
  const left = goods.filter((l) => !map.has(l.key));
  const used = new Set([...map.values()].map((p) => p.id));
  const spare = received.filter((r) => !used.has(r.id));
  if (left.length === 1 && spare.length === 1) map.set(left[0].key, spare[0]);
  return map;
}

/** Per part on a trade order: what this note delivers against what the store has plus what already left it for this order. */
async function tradeStock(orderId: string, plan: DeliveryLine[], delivered: Record<string, number>) {
  const parts = await tradeParts(orderId, plan);
  const now = new Map<string, number>(), before = new Map<string, number>();
  const noPart: string[] = [];
  for (const l of plan) {
    if (l.kind !== "PO" || l.isService) continue;
    const qty = delivered[l.key] ?? 0;
    const part = parts.get(l.key);
    if (!part) { if (qty > 0) noPart.push(l.description.slice(0, 60)); continue; }
    now.set(part.sku, (now.get(part.sku) ?? 0) + qty);
    before.set(part.sku, (before.get(part.sku) ?? 0) + l.deliveredBefore);
  }
  const short: string[] = [];
  const issue: { partSku: string; qty: number }[] = []; // what still has to leave the store for this note
  for (const [sku, qty] of now) {
    if (qty <= 0) continue;
    const part = await prisma.part.findUniqueOrThrow({ where: { sku } });
    const out = await prisma.stockMovement.aggregate({ _sum: { qty: true }, where: { partId: part.id, direction: "OUT", serviceOrderId: orderId } });
    const taken = Math.max(0, Number(out._sum.qty ?? 0) - (before.get(sku) ?? 0)); // already out of the store for this order and not yet delivered
    const onHand = await stockOnHand(sku);
    if (qty > onHand + taken + 1e-9) short.push(`${sku} ${qty}/${Math.max(0, onHand + taken)}`);
    else if (qty > taken) issue.push({ partSku: sku, qty: qty - taken });
  }
  return { parts, noPart, short, issue };
}

/** Lines whose delivered quantity does not match what is still due. Service lines are never delivered. */
export function mismatches(plan: DeliveryLine[], delivered: Record<string, number>, partial: boolean) {
  return plan.filter((l) => !l.isService).map((l) => ({ ...l, due: l.expected - l.deliveredBefore, now: delivered[l.key] ?? 0 })).filter((l) => (partial ? l.now > l.due : l.now !== l.due) || l.now < 0);
}

export const DeliveryInput = z.object({
  serviceOrderNo: z.string(),
  actorCode: z.string(),
  deliverOn: z.coerce.date(),
  plantId: z.string().optional(),
  address: z.string().optional(),
  contactId: z.string().optional(),
  driverCode: z.string().optional(),
  vehicle: z.string().optional(),
  delivered: z.record(z.number()),
  partial: z.boolean().default(false), /// split delivery: quantities may be below what is due, never above
  overrideReason: z.string().optional(),
  remark: z.string().optional(),
  draft: z.boolean().default(false), /// save without checking; the same DNTH is issued later
});

/** Issue a DNTH (checked against the PO), or save/update this order's draft. An open draft is reused, so it keeps its number. */
export async function issueDelivery(input: z.input<typeof DeliveryInput>) {
  const d = DeliveryInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { decline: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  // 客户拒绝报价: the return DNTH always says the machine goes back unrepaired, whatever else the remark says
  if (order.decline) { const note = returnRemark(order.decline.toldAt); if (!d.remark?.includes("Returned unrepaired")) d.remark = d.remark ? `${note}\n${d.remark}` : note; }
  if (!d.draft) {
    const blocked = await partnerDeliveryBlockers(order.id); // 合作维修: our retest must pass before the machine goes back
    if (blocked.length) throw new Error(`RETEST_NOT_PASSED:${blocked.join(",")}`);
  }
  const { lines } = await deliveryPlan(order.no);
  const bad = d.draft ? [] : mismatches(lines, d.delivered, d.partial);
  if (bad.length && !d.overrideReason) throw new Error(`DELIVERY_MISMATCH:${bad.map((b) => `${b.description} ${b.now}/${b.due}`).join("; ")}`);
  if (bad.length && actor.role !== "MD") throw new Error("DELIVERY_OVERRIDE_MD_ONLY");
  if (!d.draft && !lines.some((l) => (d.delivered[l.key] ?? 0) > 0)) throw new Error("DELIVERY_EMPTY");
  // 贸易 (trial finding 2026-11-14: three were delivered with two in stock): goods on a trade order can go out only if they
  // are in the store or were already taken out of it for this order — and no reason overrides that, the goods are not there
  const trade = !d.draft && isTradeMode(order.mode) ? await tradeStock(order.id, lines, d.delivered) : null;
  if (trade?.noPart.length) throw new Error(`DELIVERY_NO_PART:${trade.noPart.join("; ")}`);
  if (trade?.short.length) throw new Error(`DELIVERY_NO_STOCK:${trade.short.join("; ")}`);
  const driver = d.driverCode ? await prisma.employee.findUniqueOrThrow({ where: { code: d.driverCode } }) : null;
  const draft = await prisma.deliveryNote.findFirst({ where: { serviceOrderId: order.id, status: "DRAFT" } });
  const data = {
    status: d.draft ? ("DRAFT" as const) : ("ISSUED" as const), deliverOn: d.deliverOn, plantId: d.plantId ?? order.plantId, address: d.address ?? null, contactId: d.contactId ?? null, driverId: driver?.id ?? null, vehicle: d.vehicle ?? null,
    lines: lines.map((l) => ({ ...l, partSku: trade?.parts.get(l.key)?.sku ?? l.partSku, delivered: d.delivered[l.key] ?? 0 })) as unknown as Prisma.InputJsonValue,
    mismatch: bad.length ? (bad as unknown as Prisma.InputJsonValue) : undefined, overrideReason: bad.length ? d.overrideReason : null, overrideById: bad.length ? actor.id : null, remark: d.remark ?? null,
  };
  const dn = await prisma.$transaction(async (tx) => {
    const dn = draft
      ? await tx.deliveryNote.update({ where: { id: draft.id }, data })
      : await tx.deliveryNote.create({ data: { ...data, no: await allocateNumber(tx, { prefix: "DN", createdByEmployeeCode: actor.code, entityId: order.entityId, date: d.deliverOn }), serviceOrderId: order.id } });
    if (d.draft) return dn;
    // Only an issued note is a registered document (printable, listed in the portal).
    await tx.document.create({ data: { no: dn.no, type: "DN", entityId: order.entityId, countryCode: dn.no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, templateCode: "19", issuedAt: d.deliverOn } });
    if (bad.length) await audit(actor.id, "DELIVERY_OVERRIDE", dn.no, { reason: d.overrideReason, mismatch: bad.map((b) => ({ key: b.key, due: b.due, now: b.now })) }, tx);
    return dn;
  });  // the goods leave the store with the note (one OBTH), so the next order sees what is really left
  if (trade?.issue.length) {
    const ob = await recordStockDoc({ actorCode: actor.code, direction: "OUT", serviceOrderNo: order.no, movedAt: d.deliverOn, lines: trade.issue });
    await audit(actor.id, "DELIVERY_STOCK_OUT", dn.no, { obth: ob.no, lines: trade.issue });
  }
  return dn;
}

/** Customer signed for it: DELIVERED on each asset's timeline. */
export async function signDelivery(input: { no: string; actorCode: string; signedBy: string; signedAt?: Date; remark?: string; attachments?: { name: string; url: string; kind?: string }[] }) {
  const dn = await prisma.deliveryNote.findUniqueOrThrow({ where: { no: input.no }, include: { serviceOrder: { include: { assets: true, plant: true } } } });
  if (dn.status === "SIGNED") throw new Error(`${dn.no} is already signed`);
  if (dn.status === "DRAFT") throw new Error("DELIVERY_NOT_ISSUED");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const codes = new Set((dn.lines as { assetCode?: string; delivered: number }[]).filter((l) => l.delivered > 0 && l.assetCode).map((l) => l.assetCode!));
  const assets = await prisma.asset.findMany({ where: { code: { in: [...codes] } } });
  const signed = await prisma.$transaction(async (tx) => {
    const signed = await tx.deliveryNote.update({ where: { id: dn.id }, data: { status: "SIGNED", signedBy: input.signedBy, signedAt: input.signedAt ?? new Date(), remark: input.remark ?? dn.remark, signatureUrl: input.attachments?.find((a) => a.kind !== "CUSTOMER_DN")?.url ?? input.attachments?.[0]?.url, attachments: input.attachments?.length ? ([...((dn.attachments as unknown[] | null) ?? []), ...input.attachments] as Prisma.InputJsonValue) : undefined } });
    for (const a of assets.length ? assets : []) {
      await tx.assetEvent.create({ data: { assetId: a.id, type: "DELIVERED", actorId: actor.id, actorName: input.signedBy, serviceOrderId: dn.serviceOrderId, sourceDocNo: dn.no, occurredAt: input.signedAt, summary: dn.no, payload: { signedBy: input.signedBy, remark: input.remark } as Prisma.InputJsonValue, attachments: (input.attachments ?? []) as Prisma.InputJsonValue } });
    }
    return signed;
  });
  // 贸易 (2026-11-09): the customer's signature on the last DNTH is the acceptance — the order is accepted and locked
  // (cost, price, purchasing) once every PO line is delivered and no delivery note is still waiting for a signature.
  const order = dn.serviceOrder;
  if (isTradeMode(order.mode) && !order.lockedAt && (order.status === "IN_PROGRESS" || order.status === "ACCEPTANCE_PENDING")) {
    const { lines } = await deliveryPlan(order.no);
    const open = await prisma.deliveryNote.count({ where: { serviceOrderId: order.id, status: { notIn: ["SIGNED", "DRAFT"] } } });
    if (!open && lines.every((l) => l.kind !== "PO" || l.isService || l.deliveredBefore >= l.expected)) {
      await prisma.$transaction(async (tx) => {
        await progressOrder(tx, order, "ACCEPTED", actor.id, dn.no);
        await tx.serviceOrder.update({ where: { id: order.id }, data: { lockedAt: input.signedAt ?? new Date(), lockedById: actor.id } });
      });
    }
  }
  return signed;
}
