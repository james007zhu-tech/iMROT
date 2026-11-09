/**
 * 客户拒绝报价 (朱总 2026-11-09, mockup docs/mockups/quote-decline-v0.1.html; rules in src/lib/decline.ts).
 * declineQuote → order DECLINED and locked, the customer's reply kept, open inquiries cancelled, one QUOTE_DECLINED
 * event per machine (machine status untouched — 11-08 decision). The machine goes back on a DNTH (deliveryPlan), the
 * fee on a TITH (issueTaxInvoice → declineInvoiceLines), and the order is closed by hand once declineCloseBlockers is empty.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { declineBlocker, declineInputError, feeLineText, feeTotal, undoDeclineBlocker, type DeclineFee, type DeclineShape } from "@/lib/decline";

type Att = { name: string; url: string; kind?: string };

export interface DeclineInput {
  no: string; actorCode: string;
  reason: string; note?: string; toldAt?: Date; contactId?: string;
  waived: boolean; waivedReason?: string;
  fees: DeclineFee[];
  attachments: Att[]; /// the customer's reply — required
}

export async function declineQuote(d: DeclineInput) {
  const [order, actor] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.no }, include: { assets: { include: { asset: true } } } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } }),
  ]);
  const blocked = declineBlocker(order);
  if (blocked) throw new Error(`${blocked}:${order.no}`);
  const codes = order.assets.map((l) => l.asset.code);
  const fees = d.waived ? [] : codes.map((c) => ({ assetCode: c, amount: Math.round(Number(d.fees.find((f) => f.assetCode === c)?.amount ?? 0) * 100) / 100 }));
  const bad = declineInputError({ reason: d.reason, attachments: d.attachments.length, waived: d.waived, waivedReason: d.waivedReason, fees, assetCodes: codes });
  if (bad) throw new Error(bad);
  if (d.contactId) {
    const c = await prisma.contact.findUnique({ where: { id: d.contactId } });
    if (!c || c.customerId !== order.customerId) throw new Error("INVALID_INPUT:contactId");
  }
  const toldAt = d.toldAt ?? new Date();
  const total = feeTotal(fees);
  return prisma.$transaction(async (tx) => {
    const decline = await tx.quoteDecline.create({
      data: { serviceOrderId: order.id, reason: d.reason, note: d.note ?? null, toldAt, contactId: d.contactId ?? null, fees: fees as Prisma.InputJsonValue, waivedReason: d.waived ? d.waivedReason!.trim() : null, actorId: actor.id },
    });
    const kept = (order.attachments as Att[] | null) ?? [];
    await tx.serviceOrder.update({
      where: { id: order.id },
      // locked like an accepted order: no new prices, purchase inquiries or purchase orders from here on
      data: { status: "DECLINED", lockedAt: new Date(), lockedById: actor.id, attachments: [...kept, ...d.attachments.map((a) => ({ ...a, kind: "DECLINE" }))] as Prisma.InputJsonValue },
    });
    await tx.purchaseInquiry.updateMany({ where: { serviceOrderId: order.id, status: { in: ["OPEN", "COMPARED"] } }, data: { status: "CANCELLED" } });
    for (const l of order.assets) {
      const fee = fees.find((f) => f.assetCode === l.asset.code)?.amount ?? 0;
      await tx.assetEvent.create({
        data: { assetId: l.assetId, type: "QUOTE_DECLINED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, occurredAt: toldAt,
          summary: [d.reason, d.note].filter(Boolean).join(" · "),
          payload: { reason: d.reason, fee, currency: order.currency, waived: d.waived, statusFrom: l.asset.status, statusTo: l.asset.status } as Prisma.InputJsonValue },
      });
    }
    await audit(actor.id, "QUOTE_DECLINED", order.no, { reason: d.reason, feeTotal: total, waived: d.waived, waivedReason: d.waived ? d.waivedReason : undefined }, tx);
    return decline;
  });
}

/** The decline state of an order, for close/undo checks and the order page. Null when the order was not declined. */
export async function declineShapeOf(no: string): Promise<(DeclineShape & { fees: DeclineFee[]; waivedReason: string | null }) | null> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({
    where: { no },
    include: { decline: true, documents: { where: { type: "ER", voidedAt: null }, select: { id: true } }, deliveries: { select: { status: true } }, taxInvoices: { select: { voidedAt: true } } },
  });
  if (!o.decline) return null;
  const fees = (o.decline.fees as DeclineFee[] | null) ?? [];
  return {
    status: o.status, fees, waivedReason: o.decline.waivedReason,
    feeDue: feeTotal(fees) > 0,
    invoiced: o.taxInvoices.some((t) => !t.voidedAt),
    returnNeeded: o.documents.length > 0,
    returnSigned: o.deliveries.some((x) => x.status === "SIGNED"),
    returnIssued: o.deliveries.some((x) => x.status === "ISSUED" || x.status === "SIGNED"),
  };
}

/** The customer changed their mind: back to 待确认报价, quote unlocked. Only before a DNTH or TITH went out. */
export async function undoDecline(input: { no: string; actorCode: string }) {
  const [order, actor, shape] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, include: { assets: true } }),
    prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } }),
    declineShapeOf(input.no),
  ]);
  const blocked = shape ? undoDeclineBlocker(shape) : "NOT_DECLINED";
  if (blocked) throw new Error(`${blocked}:${order.no}`);
  return prisma.$transaction(async (tx) => {
    await tx.quoteDecline.delete({ where: { serviceOrderId: order.id } });
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: "QUOTE_PENDING", lockedAt: null, lockedById: null } });
    for (const a of order.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, summary: `${order.no} DECLINED → QUOTE_PENDING`, payload: { orderStatusFrom: "DECLINED", orderStatusTo: "QUOTE_PENDING", undoDecline: true } } });
    }
    await audit(actor.id, "QUOTE_DECLINE_UNDONE", order.no, {}, tx);
  });
}

/** Tax-invoice lines for a declined order: one inspection-fee line per charged machine. */
export async function declineInvoiceLines(no: string): Promise<{ descriptionLocal: string; descriptionEn: string; qty: number; unit: string; unitPrice: number }[]> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { decline: true, assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } } } });
  if (!o.decline) return [];
  return ((o.decline.fees as DeclineFee[] | null) ?? []).filter((f) => f.amount > 0).map((f) => {
    const a = o.assets.find((l) => l.asset.code === f.assetCode)?.asset;
    const text = feeLineText({ code: f.assetCode, brand: a?.model?.series.brand.name, model: a?.model ? `${a.model.series.name} ${a.model.code}` : a?.type ?? undefined, serial: a?.serialNumber ?? undefined });
    return { ...text, qty: 1, unit: "ครั้ง", unitPrice: f.amount };
  });
}
