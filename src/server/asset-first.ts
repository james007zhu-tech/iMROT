/**
 * 设备优先 (朱总 2026-11-11): the machine is the starting point. Its serial number is its identity and one ATH stands
 * for exactly one serial number. QTTH, ERTH and INTH are all opened from the ATH — a machine may arrive and be
 * inspected before anyone has quoted — and the system works out which QTTH an ERTH or INTH belongs to:
 *
 *   · opened while the machine has an open QTTH  → it belongs to that QTTH (the latest, if there are several);
 *   · opened with none                           → it stays with the machine, and the next QTTH opened for the
 *                                                   machine adopts it;
 *   · a person may move it afterwards (relinkDoc) when the system guessed wrong.
 *
 * Everything after that (RPTH, PMTH, DNTH, acceptance, TITH, IVTH, RCTH) hangs on the QTTH as before.
 */
import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";

type Db = Prisma.TransactionClient | typeof prisma;
const DONE: ServiceOrderStatus[] = ["CLOSED", "CANCELLED"];
/** A loose ERTH or INTH older than this is history, not the start of the next job. */
const ADOPT_DAYS = 120;

/** One spelling per serial number: upper case, no spaces — "sn 12-ab" and "SN12-AB " are the same machine. */
export const normSerial = (s: string) => s.normalize("NFKC").toUpperCase().replace(/\s+/g, "");

/** The ATH that already carries this serial number, if any (whatever model it was filed under). */
export async function assetBySerial(db: Db, serial: string, exceptId?: string) {
  const n = normSerial(serial);
  if (!n) return null;
  const rows = await db.$queryRaw<{ id: string; code: string }[]>`SELECT id, code FROM "Asset" WHERE upper(regexp_replace("serialNumber", '\\s+', '', 'g')) = ${n} LIMIT 2`;
  return rows.find((r) => r.id !== exceptId) ?? null;
}

/** The QTTH a new ERTH or INTH of this machine belongs to: its latest order that is still open. */
export async function openOrderFor(db: Db, assetId: string) {
  return db.serviceOrder.findFirst({ where: { assets: { some: { assetId } }, status: { notIn: DONE } }, orderBy: { createdAt: "desc" } });
}

/**
 * A QTTH was just opened for these machines: the ERTH and INTH they collected while no QTTH existed now belong to it.
 * Returns the adopted numbers; `inspected` says an INTH came with them (the order can start at "diagnosed").
 */
export async function adoptLooseDocs(tx: Prisma.TransactionClient, order: { id: string }, assetIds: string[]) {
  const since = new Date(Date.now() - ADOPT_DAYS * 86_400_000);
  const events = await tx.assetEvent.findMany({ where: { assetId: { in: assetIds }, serviceOrderId: null, type: { in: ["RECEIVED_WORKSHOP", "INSPECTED"] }, sourceDocNo: { not: null }, occurredAt: { gte: since } }, select: { id: true, sourceDocNo: true, type: true } });
  const insps = await tx.inspection.findMany({ where: { assetId: { in: assetIds }, serviceOrderId: null, inspectedAt: { gte: since } }, select: { id: true, no: true, draft: true, engineerId: true } });
  const nos = [...new Set([...events.map((e) => e.sourceDocNo!), ...insps.map((i) => i.no)])];
  if (!nos.length) return { nos, inspected: null as null | { engineerId: string } };
  await tx.assetEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { serviceOrderId: order.id } });
  await tx.inspection.updateMany({ where: { id: { in: insps.map((i) => i.id) } }, data: { serviceOrderId: order.id } });
  // an ERTH that took in several machines follows the order only when every machine on it now belongs to that order
  for (const no of nos) {
    const others = await tx.assetEvent.count({ where: { sourceDocNo: no, OR: [{ serviceOrderId: null }, { serviceOrderId: { not: order.id } }] } });
    if (!others) await tx.document.updateMany({ where: { no, serviceOrderId: null }, data: { serviceOrderId: order.id } });
  }
  const done = insps.find((i) => !i.draft);
  return { nos, inspected: done ? { engineerId: done.engineerId } : null };
}

/** A person corrects the system's guess: this ERTH or INTH belongs to that QTTH (or to none). The machine must be on the order. */
export async function relinkDoc(input: { docNo: string; orderNo: string | null; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const doc = await prisma.document.findUniqueOrThrow({ where: { no: input.docNo } });
  if (doc.type !== "ER" && doc.type !== "IN") throw new Error(`RELINK_ONLY_ER_IN:${doc.no}`);
  const events = await prisma.assetEvent.findMany({ where: { sourceDocNo: doc.no }, select: { id: true, assetId: true } });
  const order = input.orderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.orderNo }, include: { assets: { select: { assetId: true } } } }) : null;
  if (order && !events.some((e) => order.assets.some((a) => a.assetId === e.assetId))) throw new Error(`RELINK_ASSET_NOT_ON_ORDER:${order.no}`);
  const mine = order ? events.filter((e) => order.assets.some((a) => a.assetId === e.assetId)) : events;
  await prisma.$transaction([
    prisma.assetEvent.updateMany({ where: { id: { in: mine.map((e) => e.id) } }, data: { serviceOrderId: order?.id ?? null } }),
    prisma.inspection.updateMany({ where: { no: doc.no }, data: { serviceOrderId: order?.id ?? null } }),
    prisma.document.update({ where: { id: doc.id }, data: { serviceOrderId: order && mine.length === events.length ? order.id : order ? doc.serviceOrderId : null } }),
  ]);
  await audit(actor.id, "DOC_RELINK", doc.no, { to: order?.no ?? null });
}

/** 序列号核对: someone held the machine and confirmed the ATH's serial number against it. Internal numbers need a manager or the MD. */
export async function verifySerial(db: Db, assetId: string, actor: { id: string; role: string }) {
  const a = await db.asset.findUniqueOrThrow({ where: { id: assetId }, select: { serialSource: true, serialVerifiedAt: true } });
  if (a.serialSource === "INTERNAL" && !["MD", "MANAGER", "ADMIN"].includes(actor.role)) return false; // stays waiting for a manager
  if (!a.serialVerifiedAt) await db.asset.update({ where: { id: assetId }, data: { serialVerifiedAt: new Date(), serialVerifiedById: actor.id } });
  return true;
}
export async function confirmSerial(input: { assetCode: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const a = await prisma.asset.findUniqueOrThrow({ where: { code: input.assetCode } });
  if (a.serialSource === "INTERNAL" && !["MD", "MANAGER", "ADMIN"].includes(actor.role)) throw new Error("SERIAL_CONFIRM_NEEDS_MANAGER");
  await prisma.asset.update({ where: { id: a.id }, data: { serialVerifiedAt: new Date(), serialVerifiedById: actor.id } });
  await audit(actor.id, "SERIAL_VERIFIED", a.code, { serial: a.serialNumber, source: a.serialSource });
}

/** 自动化项目 (朱总 2026-11-11 "项目交付时建 ATH"): a machine we deliver is filed as an ATH and put on the project's QTTH. */
export async function attachProjectAsset(input: { orderNo: string; assetCode: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.orderNo }, include: { assets: true } });
  if (order.mode !== "AUTOMATION_PROJECT") throw new Error("ATTACH_ONLY_PROJECT");
  const asset = await prisma.asset.findUniqueOrThrow({ where: { code: input.assetCode } });
  if (asset.customerId !== order.customerId) throw new Error(`ASSET_OTHER_CUSTOMER:${asset.code}`);
  if (order.assets.some((a) => a.assetId === asset.id)) return;
  await prisma.$transaction([
    prisma.serviceOrderAsset.create({ data: { serviceOrderId: order.id, assetId: asset.id, isPrimary: order.assets.length === 0 } }),
    prisma.assetEvent.create({ data: { assetId: asset.id, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, summary: `Delivered under project ${order.no}` } }),
  ]);
}

/** What a machine holds that no QTTH has claimed yet. */
export async function looseDocsOf(assetId: string) {
  const ev = await prisma.assetEvent.findMany({ where: { assetId, serviceOrderId: null, type: { in: ["RECEIVED_WORKSHOP", "INSPECTED"] }, sourceDocNo: { not: null } }, orderBy: { occurredAt: "desc" }, select: { sourceDocNo: true, type: true, occurredAt: true, summary: true } });
  const drafts = await prisma.inspection.findMany({ where: { assetId, serviceOrderId: null, draft: true }, select: { no: true, inspectedAt: true } });
  return [...ev.map((e) => ({ no: e.sourceDocNo!, type: e.type === "INSPECTED" ? "IN" : "ER", at: e.occurredAt, summary: e.summary, draft: false })), ...drafts.map((d) => ({ no: d.no, type: "IN", at: d.inspectedAt, summary: "", draft: true }))];
}
