/**
 * SCM Phase 1 slice: stock movements. An OUT movement into an asset writes PART_REPLACED on that asset.
 * Parts are keyed by brand + vendor part no, never by customer, so the same SKU can be matched across customers.
 */
import { assertNotSettled } from "./job-cost";
import { can, hasRole } from "@/lib/caps";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertNotLocked } from "@/server/slm";
import { allocateNumber } from "@/lib/numbering-db";
import type { Prisma } from "@prisma/client";

const Line = z.object({
  partSku: z.string(),
  qty: z.number().positive(),
  batch: z.string().optional(),
  unitCost: z.number().optional(),
  oldPartDisposition: z.string().optional(),
});

export const StockDocInput = z.object({
  actorCode: z.string(),
  direction: z.enum(["IN", "OUT"]),
  warehouse: z.string().default("RAYONG"),
  assetCode: z.string().optional(),
  serviceOrderNo: z.string().optional(),
  supplierRef: z.string().optional(),
  refNo: z.string().optional(), // 退料: the OBTH these parts are handed back from (N-42)
  costCurrency: z.string().optional(),
  movedAt: z.coerce.date().optional(),
  lines: z.array(Line).min(1, "a stock document needs at least one line"),
});

/** One spelling per part number: upper case, no spaces. */
export const normPartNo = (s: string) => s.normalize("NFKC").toUpperCase().replace(/\s+/g, "");

/**
 * Finds parts by whatever number people actually write (trial finding 2026-11-14: a purchase order carries the maker's
 * own number, the library's SKU is that number behind a brand prefix, and receiving answered "unknown part number").
 * A key matches, in this order: the SKU itself; the maker's part number; the SKU without its brand prefix.
 * A maker's number that two brands share is ambiguous and is refused rather than guessed.
 */
export async function resolveParts(keys: string[]) {
  const wanted = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  const found = new Map<string, Awaited<ReturnType<typeof prisma.part.findMany>>[number]>();
  const unknown: string[] = [], ambiguous: string[] = [];
  for (const key of wanted) {
    const n = normPartNo(key);
    // '\\s+' — two backslashes: in a template literal a single one is dropped, the database then saw 's+' and took the
    // letter s out instead of the spaces, so a part number with a space in it (or a small s) was "unknown" (朱总 2026-11-28)
    const hits = await prisma.$queryRaw<{ id: string; sku: string; vendor: string }[]>`
      SELECT id, sku, "vendorPartNo" AS vendor FROM "Part"
      WHERE upper(regexp_replace(sku, '\\s+', '', 'g')) = ${n}
         OR upper(regexp_replace("vendorPartNo", '\\s+', '', 'g')) = ${n}
         OR upper(regexp_replace(sku, '\\s+', '', 'g')) LIKE ${"%-" + n.replace(/[\\%_]/g, "\\$&")}
      LIMIT 20`;
    const exact = hits.filter((h) => normPartNo(h.sku) === n);
    const pick = exact.length ? exact : hits;
    if (!pick.length) { unknown.push(key); continue; }
    if (pick.length > 1) { ambiguous.push(`${key} → ${pick.map((h) => h.sku).join(" / ")}`); continue; }
    found.set(key, (await prisma.part.findUniqueOrThrow({ where: { id: pick[0].id } })));
  }
  return { found, unknown, ambiguous };
}
/** One part by any of its numbers, or null. */
export async function findPart(key: string | null | undefined) {
  if (!key?.trim()) return null;
  return (await resolveParts([key])).found.get(key.trim()) ?? null;
}

/**
 * One IBTH / OBTH document = one number, any number of SKU lines (decision 2026-11-04).
 * Each line moves exactly one SKU, so stock on hand stays per SKU; an OUT line into an asset writes PART_REPLACED.
 */
export async function recordStockDoc(input: z.input<typeof StockDocInput>, opts: { costFromPo?: boolean } = {}) {
  const d = StockDocInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  if (!can.stock(actor)) throw new Error("NO_PERMISSION"); // 出入库: MD, PUR and — since 2026-11-27 (朱总) — the engineers, in and out
  const { found, unknown, ambiguous } = await resolveParts(d.lines.map((l) => l.partSku));
  if (ambiguous.length) throw new Error(`AMBIGUOUS_SKU:${ambiguous.join("; ")}`);
  if (unknown.length) throw new Error(`UNKNOWN_SKU:${unknown.join(",")}`);
  const asset = d.assetCode ? await prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }) : null;
  if (order) assertNotLocked(order);
  await assertNotSettled(order); // 开票即结算: nothing more is issued to (or returned from) an invoiced order
  if (d.direction === "OUT" && !asset && !order) throw new Error("an OUT movement must name the asset or the service order it serves");
  // N-42 退料选原出库单: what comes back is at most what that issue took out, less what already came back
  if (d.refNo) {
    if (d.direction !== "IN" || !order) throw new Error("RETURN_NEEDS_ORDER");
    const src = await prisma.stockMovement.findMany({ where: { no: d.refNo, direction: "OUT", kind: "PART", reversedBy: null, reversalOf: null }, select: { partId: true, qty: true, serviceOrderId: true } });
    if (!src.length || src.some((m) => m.serviceOrderId !== order.id)) throw new Error(`RETURN_OB_NOT_FOUND:${d.refNo}`);
    const backs = await prisma.stockMovement.findMany({ where: { refNo: d.refNo, direction: "IN", kind: "PART", reversedBy: null, reversalOf: null }, select: { partId: true, qty: true } });
    const room = new Map<string, number>();
    for (const m of src) room.set(m.partId!, (room.get(m.partId!) ?? 0) + Number(m.qty));
    for (const m of backs) room.set(m.partId!, (room.get(m.partId!) ?? 0) - Number(m.qty));
    const want = new Map<string, { sku: string; qty: number }>();
    for (const l of d.lines) { const p = found.get(l.partSku.trim())!; want.set(p.id, { sku: p.sku, qty: (want.get(p.id)?.qty ?? 0) + l.qty }); }
    const over = [...want].filter(([id, w]) => w.qty > (room.get(id) ?? 0) + 1e-9).map(([id, w]) => `${w.sku} ${w.qty}/${Math.max(0, room.get(id) ?? 0)}`);
    if (over.length) throw new Error(`RETURN_OVER:${over.join("; ")}`);
    for (const l of d.lines) l.unitCost = undefined; // a return carries no price of its own: it goes back at what the issue cost
  }
  // nothing leaves the store that is not in it (trial finding 2026-11-14)
  // 一个库存数 (需求清单 v3 P0-07): stock is what came in minus what went out, counted over every warehouse — the
  // same figure on the list, the part page, the stock form and the delivery note. An issue is taken from the warehouse
  // named when it has the goods, else from the one that does; the movement records which.
  const takeFrom = new Map<string, string>();
  d.warehouse = d.warehouse.trim().toUpperCase() || "RAYONG";
  if (d.direction === "OUT") {
    const want = new Map<string, number>();
    for (const l of d.lines) { const p = found.get(l.partSku.trim())!; want.set(p.sku, (want.get(p.sku) ?? 0) + l.qty); }
    const short: string[] = [];
    for (const [sku, qty] of want) {
      const by = await stockByWarehouse(sku);
      const wh = (by.get(d.warehouse) ?? 0) >= qty - 1e-9 ? d.warehouse : [...by].find(([, n]) => n >= qty - 1e-9)?.[0];
      if (wh) takeFrom.set(sku, wh); else short.push(`${sku} ${qty}/${[...by.values()].reduce((a, b) => a + b, 0)}`);
    }
    if (short.length) throw new Error(`STOCK_SHORT:${short.join("; ")}`);
  }
  // 成本只给看得到成本的人填: a unit cost typed by anyone else is not taken (采购或财务补)
  // A receipt on a purchase order carries the PO's price, not a figure typed here, so it stands whoever receives the goods.
  if (!can.cost(actor) && !opts.costFromPo) for (const l of d.lines) l.unitCost = undefined;

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: d.direction === "IN" ? "IB" : "OB", createdByEmployeeCode: actor.code, entityId: actor.entityId, date: d.movedAt });
    const rows = [];
    for (const [i, l] of d.lines.entries()) {
      const part = found.get(l.partSku.trim())!;
      rows.push(await tx.stockMovement.create({
        data: { no, lineNo: i + 1, direction: d.direction, partId: part.id, qty: l.qty, warehouse: takeFrom.get(part.sku) ?? d.warehouse, batch: l.batch, assetId: asset?.id, serviceOrderId: order?.id, oldPartDisposition: l.oldPartDisposition, movedAt: d.movedAt, byName: actor.name, unitCost: d.direction === "IN" ? l.unitCost : undefined, supplierRef: d.supplierRef, refNo: d.refNo },
        include: { part: true },
      }));
      if (d.direction === "IN" && l.unitCost != null) await tx.part.update({ where: { id: part.id }, data: { lastCost: l.unitCost, lastCostCurrency: d.costCurrency ?? "THB" } });
      if (d.direction === "OUT" && asset) {
        await tx.assetEvent.create({
          data: { assetId: asset.id, type: "PART_REPLACED", actorId: actor.id, serviceOrderId: order?.id, sourceDocNo: no, occurredAt: d.movedAt,
            summary: `${part.name} (${part.sku}) ×${l.qty}${l.oldPartDisposition ? ` · old: ${l.oldPartDisposition}` : ""}`,
            payload: { partSku: part.sku, qty: l.qty, batch: l.batch, oldPartDisposition: l.oldPartDisposition, lineNo: i + 1 } as Prisma.InputJsonValue },
        });
      }
    }
    await tx.document.create({ data: { no, type: d.direction === "IN" ? "IB" : "OB", entityId: actor.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id, issuedAt: d.movedAt } });
    return { no, lines: rows };
  });
}

/**
 * 作废 / 红冲 (N-42): a stock document is never deleted. Voiding writes the opposite movements under a new number (an
 * IBTH is taken back out by an OBTH, an OBTH is put back by an IBTH), so the stock on hand is right again and both
 * documents stay in the ledger. Neither counts in the first-in-first-out batches any more.
 * Refused when undoing it would change something already settled: an invoiced order (开票即结算), a receipt whose
 * goods have already gone out, a receipt the supplier's invoice is already booked against, an issue with returns.
 */
export async function voidStockDoc(input: { no: string; actorCode: string; reason: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "MD", "PURCHASING")) throw new Error("NO_PERMISSION"); // 出入库归 PUR
  const reason = input.reason.trim();
  if (reason.length < 2) throw new Error("VOID_REASON_REQUIRED");
  const rows = await prisma.stockMovement.findMany({ where: { no: input.no }, orderBy: { lineNo: "asc" }, include: { part: true, serviceOrder: true } });
  if (!rows.length) throw new Error("NOT_FOUND");
  if (rows.some((r) => r.kind !== "PART")) throw new Error("STOCK_VOID_CUSTODY"); // 外送 / 外协返回 are undone on the subcontract itself
  if (rows.some((r) => r.reversedBy || r.reversalOf)) throw new Error("STOCK_VOID_DONE");
  const head = rows[0], isIn = head.direction === "IN", order = rows.find((r) => r.serviceOrder)?.serviceOrder ?? null;
  if (order) assertNotLocked(order);
  await assertNotSettled(order);
  const po = head.purchaseOrderId ? await prisma.purchaseOrder.findUnique({ where: { id: head.purchaseOrderId }, include: { invoices: { where: { status: { not: "CANCELLED" }, accrued: false } } } }) : null;
  if (isIn) {
    if (po?.invoices.length) throw new Error(`STOCK_VOID_PO_INVOICED:${po.no}`);
    const { fifoOf } = await import("./fifo");
    const fifo = await fifoOf([...new Set(rows.map((r) => r.partId!))]);
    const used = rows.filter((r) => { const b = fifo.get(r.partId!)?.all.find((x) => x.inId === r.id); return b ? b.left < b.qty - 1e-9 : false; }).map((r) => r.part!.sku);
    if (used.length) throw new Error(`STOCK_VOID_USED:${[...new Set(used)].join(", ")}`);
    const short: string[] = [];
    for (const r of rows) { const by = await stockByWarehouse(r.part!.sku); if ((by.get(r.warehouse) ?? 0) < Number(r.qty) - 1e-9) short.push(r.part!.sku); }
    if (short.length) throw new Error(`STOCK_VOID_USED:${[...new Set(short)].join(", ")}`);
  } else {
    const back = await prisma.stockMovement.findFirst({ where: { refNo: input.no, direction: "IN", kind: "PART", reversedBy: null, reversalOf: null }, select: { no: true } });
    if (back) throw new Error(`STOCK_VOID_HAS_RETURN:${back.no}`);
    const dn = order ? await prisma.document.findFirst({ where: { serviceOrderId: order.id, type: "DN", voidedAt: null, issuedAt: { gte: head.movedAt } }, select: { no: true } }) : null;
    if (dn) throw new Error(`STOCK_VOID_DELIVERED:${dn.no}`); // the goods have gone to the customer on a delivery note
  }
  const now = new Date();
  const res = await prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: isIn ? "OB" : "IB", createdByEmployeeCode: actor.code, entityId: actor.entityId, date: now });
    for (const r of rows) {
      await tx.stockMovement.create({ data: { no, lineNo: r.lineNo, direction: isIn ? "OUT" : "IN", kind: "PART", partId: r.partId, qty: r.qty, warehouse: r.warehouse, batch: r.batch, assetId: r.assetId, serviceOrderId: r.serviceOrderId, purchaseOrderId: r.purchaseOrderId, movedAt: now, byName: actor.name, unitCost: r.unitCost, reversalOf: r.no, voidReason: reason } });
      await tx.stockMovement.update({ where: { id: r.id }, data: { reversedBy: no, voidReason: reason } });
      if (!isIn && r.assetId) await tx.assetEvent.create({ data: { assetId: r.assetId, type: "PART_REPLACED", actorId: actor.id, serviceOrderId: r.serviceOrderId, sourceDocNo: no, occurredAt: now, summary: `VOID ${r.no}: ${r.part!.name} (${r.part!.sku}) ×${Number(r.qty)} — ${reason}`, payload: { voidOf: r.no, partSku: r.part!.sku, qty: -Number(r.qty), reason } as Prisma.InputJsonValue } });
    }
    await tx.document.create({ data: { no, type: isIn ? "OB" : "IB", entityId: actor.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id, issuedAt: now } });
    await tx.document.updateMany({ where: { no: input.no }, data: { voidedAt: now, voidReason: reason } });
    // a receipt taken back no longer sets the part's last purchase price: the latest receipt still standing does
    if (isIn) for (const pid of new Set(rows.map((r) => r.partId!))) {
      const last = await tx.stockMovement.findFirst({ where: { partId: pid, direction: "IN", kind: "PART", unitCost: { not: null }, reversedBy: null, reversalOf: null }, orderBy: { movedAt: "desc" }, select: { unitCost: true } });
      if (last) await tx.part.update({ where: { id: pid }, data: { lastCost: last.unitCost } });
    }
    if (po) { // the purchase order gets its received quantities back
      const lines = po.lines as { lineNo: number; partSku?: string; qty: number; receivedQty: number }[];
      for (const r of rows) { let left = Number(r.qty); for (const l of [...lines].reverse()) { if (left <= 1e-9) break; if (l.partSku !== r.part!.sku) continue; const q = Math.min(left, Number(l.receivedQty ?? 0)); l.receivedQty = Math.round((Number(l.receivedQty ?? 0) - q) * 1000) / 1000; left -= q; } }
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { lines: lines as unknown as Prisma.InputJsonValue, status: lines.some((l) => Number(l.receivedQty ?? 0) > 1e-9) ? "PARTIAL" : "SENT" } });
    }
    await tx.auditLog.create({ data: { actorId: actor.id, action: "STOCK_DOC_VOIDED", target: input.no, detail: { by: no, reason, order: order?.no ?? null, po: po?.no ?? null } } });
    return { no };
  });
  if (po) await (await import("./srm")).syncAccrual(po.id);
  return res;
}

export const MovementInput = z.object({
  actorCode: z.string(),
  direction: z.enum(["IN", "OUT"]),
  partSku: z.string(),
  qty: z.number().positive(),
  warehouse: z.string().default("RAYONG"),
  batch: z.string().optional(),
  assetCode: z.string().optional(),
  serviceOrderNo: z.string().optional(),
  oldPartDisposition: z.string().optional(),
  unitCost: z.number().optional(),
  costCurrency: z.string().optional(),
  movedAt: z.coerce.date().optional(),
});

/** Single-SKU shortcut (part page, API): a one-line stock document. */
export async function recordMovement(input: z.input<typeof MovementInput>) {
  const d = MovementInput.parse(input);
  const r = await recordStockDoc({ actorCode: d.actorCode, direction: d.direction, warehouse: d.warehouse, assetCode: d.assetCode, serviceOrderNo: d.serviceOrderNo, costCurrency: d.costCurrency, movedAt: d.movedAt, lines: [{ partSku: d.partSku, qty: d.qty, batch: d.batch, unitCost: d.unitCost, oldPartDisposition: d.oldPartDisposition }] });
  return r.lines[0];
}

/** Stock on hand per warehouse = IN − OUT. Warehouses with nothing in them are left out. */
export async function stockByWarehouse(partSku: string): Promise<Map<string, number>> {
  const part = await prisma.part.findUniqueOrThrow({ where: { sku: partSku } });
  const rows = await prisma.stockMovement.groupBy({ by: ["warehouse", "direction"], where: { partId: part.id }, _sum: { qty: true } });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.warehouse, (out.get(r.warehouse) ?? 0) + (r.direction === "IN" ? 1 : -1) * Number(r._sum.qty ?? 0));
  for (const [k, v] of out) if (Math.abs(v) < 1e-9) out.delete(k);
  return out;
}

/** The one stock figure of a part: IN − OUT over every warehouse (or of one warehouse when it is named). */
export async function stockOnHand(partSku: string, warehouse?: string) {
  const by = await stockByWarehouse(partSku);
  return warehouse ? by.get(warehouse) ?? 0 : [...by.values()].reduce((a, b) => a + b, 0);
}

/** Shared-spare question: which assets (across all customers) use this part, via model BOM. */
export async function assetsUsingPart(partSku: string) {
  return prisma.asset.findMany({
    where: { model: { bom: { some: { part: { sku: partSku } } } } },
    select: { code: true, serialNumber: true, status: true, customer: { select: { code: true, name: true } }, model: { select: { code: true } } },
  });
}

/** New part number: SKU = brand code + vendor part no (so the same part matches across customers). */
export async function createPart(input: { brandCode?: string; vendorPartNo: string; name: string; nameLocal?: string; unit?: string; safetyStock?: number }) {
  const vendor = input.vendorPartNo.trim();
  if (!vendor) throw new Error("vendor part number is required");
  const brand = input.brandCode ? await prisma.brand.findUnique({ where: { code: input.brandCode } }) : null;
  const sku = `${brand?.code ?? "GEN"}-${vendor}`;
  return prisma.part.create({ data: { sku, brandId: brand?.id, vendorPartNo: vendor, name: input.name, nameLocal: input.nameLocal, unit: input.unit ?? "pcs", safetyStock: input.safetyStock } });
}


/**
 * 从工单出库 (需求清单 v3 P0-08): what an order still has to take from the store — its part lines (the customer's PO,
 * else the quote) minus what has already been issued for it — with the stock on hand of each, the order's machine
 * when there is exactly one, and the open PRTH if the missing parts are already being bought.
 */
export async function issueNeeds(orderNo: string) {
  const o = await prisma.serviceOrder.findUnique({ where: { no: orderNo }, include: { lines: { include: { part: { select: { sku: true } } } }, assets: { include: { asset: { select: { code: true } } } }, inquiries: { where: { status: { not: "CANCELLED" } }, select: { no: true }, take: 1 } } });
  if (!o) return null;
  const want = new Map<string, number>();
  const po = (o.poLines as { sku?: string; qty: number; isService?: boolean }[] | null) ?? [];
  if (po.some((l) => l.sku)) { for (const l of po) if (l.sku && !l.isService) want.set(l.sku, (want.get(l.sku) ?? 0) + Number(l.qty)); }
  else for (const l of o.lines) if (l.part) want.set(l.part.sku, (want.get(l.part.sku) ?? 0) + Number(l.qty));
  const lines: { sku: string; qty: number; onHand: number }[] = [];
  for (const [key, qty] of want) {
    const part = await findPart(key).catch(() => null);
    if (!part) continue;
    const out = await prisma.stockMovement.aggregate({ _sum: { qty: true }, where: { partId: part.id, direction: "OUT", serviceOrderId: o.id, reversedBy: null, reversalOf: null } });
    const left = qty - Number(out._sum.qty ?? 0);
    if (left > 1e-9) lines.push({ sku: part.sku, qty: left, onHand: await stockOnHand(part.sku) });
  }
  const trade = o.mode === "DOMESTIC_TRADE" || o.mode === "INTERNATIONAL_TRADE";
  return { lines, hadParts: want.size > 0, assetCode: !trade && o.assets.length === 1 ? o.assets[0].asset.code : undefined, openInquiry: o.inquiries[0]?.no };
}
