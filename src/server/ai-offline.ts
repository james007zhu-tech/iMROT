/**
 * The assistant without an API key (trial 2026-11-05: it only answered "ANTHROPIC_API_KEY is not configured").
 * Keyword fallback, read-only like the model version: look up a record by its number (ATH / QTTH / INTH / CTH …),
 * show an asset's history, search by serial, and turn a dictated "new asset …" into form values for the user to check.
 * Same scope rules as the tools: a portal contact only ever sees their own customer's records.
 */
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";
import type { AssistAction, AssistContext } from "./ai";
import { findCodes, parseNewAsset } from "@/lib/assist-parse";

type Reply = { text: string; actions: AssistAction[]; toolsUsed: string[] };
const day = (d: Date | null | undefined) => (d ? localIso(d)!.slice(0, 10) : "");

export async function offlineAssist(messages: { role: "user" | "assistant"; content: string }[], ctx: AssistContext): Promise<Reply> {
  const { getTranslations } = await import("next-intl/server"); // loaded here so the services stay importable outside Next (smoke:mem)
  const u = await getTranslations({ locale: ctx.locale, namespace: "ai" });
  const [te, ts, to] = await Promise.all(["eventType", "assetStatus", "orderStatus"].map((namespace) => getTranslations({ locale: ctx.locale, namespace })));
  const q = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const scope = ctx.customerId ?? undefined;
  const lines: string[] = [];
  const used: string[] = [];

  // Dictated new asset: fill the form when it is open, otherwise say where to go.
  const draft = parseNewAsset(q);
  if (draft && !ctx.customerId) {
    const onForm = ctx.fields?.includes("serialNumber");
    const fields = Object.fromEntries(Object.entries(draft).filter(([k]) => !ctx.fields || ctx.fields.includes(k)));
    const listed = Object.entries(draft).map(([k, v]) => `${k}: ${v}`).join(" · ");
    if (onForm && Object.keys(fields).length) return { text: u("offlineFilled", { fields: listed }), actions: [{ type: "fill_form", fields }], toolsUsed: ["offline_parse"] };
    return { text: u("offlineOpenForm", { fields: listed || "—" }), actions: [{ type: "navigate", href: "/assets/new" }], toolsUsed: ["offline_parse"] };
  }

  const { assets, docs, customers } = findCodes(q);
  for (const code of assets.slice(0, 3)) {
    used.push("get_asset");
    const a = await prisma.asset.findFirst({ where: { code, customerId: scope }, include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { name: true } }, events: { orderBy: { occurredAt: "desc" }, take: 12 } } });
    if (!a) { lines.push(u("offlineNotFound", { code })); continue; }
    lines.push(`${a.code} · ${a.model ? `${a.model.series.brand.name} ${a.model.series.name} ${a.model.code}` : ""} · S/N ${a.serialNumber}`);
    lines.push(`${a.customer?.name ?? ""}${a.location ? ` · ${a.location}` : ""} · ${ts.has(a.status) ? ts(a.status) : a.status}`);
    if (a.events.length) {
      lines.push(u("offlineHistory"));
      for (const e of a.events) lines.push(`  ${day(e.occurredAt)}  ${te.has(e.type) ? te(e.type) : e.type}${e.sourceDocNo ? ` ${e.sourceDocNo}` : ""}${e.summary ? ` — ${e.summary.slice(0, 80)}` : ""}`);
    }
  }
  for (const no of docs.slice(0, 3)) {
    // A document number may be the order (QTTH) or a document of one (INTH, RPTH, DNTH …): show the order either way.
    used.push("get_order");
    const doc = no.startsWith("QT") ? null : await prisma.document.findFirst({ where: { no, customerId: scope }, select: { serviceOrderId: true, type: true, issuedAt: true } });
    const o = await prisma.serviceOrder.findFirst({ where: { customerId: scope, ...(doc?.serviceOrderId ? { id: doc.serviceOrderId } : { no }) }, include: { customer: { select: { name: true } }, assets: { include: { asset: { select: { code: true, serialNumber: true } } } }, documents: { select: { no: true, type: true, issuedAt: true }, orderBy: { issuedAt: "asc" } } } });
    if (!o) { lines.push(u("offlineNotFound", { code: no })); continue; }
    if (doc) lines.push(`${no} · ${day(doc.issuedAt)} → ${o.no}`);
    lines.push(`${o.no} · ${o.customer.name} · ${to.has(o.status) ? to(o.status) : o.status}`);
    lines.push(`${o.assets.map((l) => `${l.asset.code} (S/N ${l.asset.serialNumber})`).join(", ")}${o.reportedSymptom ? ` · ${o.reportedSymptom.slice(0, 80)}` : ""}`);
    if (o.documents.length) lines.push(`${u("offlineDocs")} ${o.documents.map((d) => `${d.no} (${day(d.issuedAt)})`).join(" · ")}`);
  }
  for (const code of customers.slice(0, 2)) {
    if (ctx.customerId) break; // portal contacts already know their own company
    used.push("get_customer");
    const c = await prisma.customer.findUnique({ where: { code }, include: { _count: { select: { assets: true, serviceOrders: true } } } });
    lines.push(c ? `${c.code} · ${c.name} · ${u("offlineCounts", { assets: c._count.assets, orders: c._count.serviceOrders })}` : u("offlineNotFound", { code }));
  }
  // Nothing recognisable: try it as a serial number or location.
  if (!lines.length) {
    const term = q.replace(/(序列号|S\/?N|serial(\s*number)?|ซีเรียล)\s*[:：]?/gi, " ").trim().split(/\s+/).filter((w) => /[A-Z0-9]{4,}/i.test(w))[0];
    if (term) {
      used.push("search_assets");
      const hits = await prisma.asset.findMany({ where: { customerId: scope, OR: [{ serialNumber: { contains: term, mode: "insensitive" } }, { location: { contains: term, mode: "insensitive" } }] }, select: { code: true, serialNumber: true, location: true }, take: 8 });
      for (const h of hits) lines.push(`${h.code} · S/N ${h.serialNumber}${h.location ? ` · ${h.location}` : ""}`);
    }
  }
  const { personNames } = await import("./ai");
  const { maskNamesInText } = await import("@/lib/mask");
  return { text: maskNamesInText([u("offlineMode"), ...(lines.length ? lines : [u("offlineHelp")])].join("\n"), await personNames()), actions: [], toolsUsed: used };
}
