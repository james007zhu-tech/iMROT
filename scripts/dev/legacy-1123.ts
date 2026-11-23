/**
 * 2026-11-23 历史数据导入（朱总 10:37 / 11:31）: what was written in the old system (简道云, export of 11-23 10:37–10:45) comes
 * in as read-only 历史单据 — old numbers kept letter for letter, outside every counter. The file is built by the matching
 * step (old number ↔ our customer / our machine); this script only writes what the file says.
 *   - LegacyDoc: one row per old record (data_id), replaced when the same record is imported again (a later export)
 *   - machines the old system registered after 11-19 under a number that is ours by now: a new ATH, the old one in
 *     configuration.renumberedFrom (same as the 917 of the first import)
 *   - contacts: added to their customer when the customer is known and no contact of that name is there yet
 *   - tax invoice counter: set to the old system's last serial, so ours carry on (TITH…208)
 * MODE=dry checks only.
 */
import { readFile } from "node:fs/promises";
import type { LegacyKind, Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { allocateNumber } from "../../src/lib/numbering-db";
import { TAX_INVOICE_RUN } from "../../src/lib/numbering";

type D = { legacyId: string; kind: LegacyKind; form: string; no: string | null; date: string | null; title: string | null; customerCode: string | null; assetCode: string | null; amount: number | null; currency: string | null; refs: string[]; data: Prisma.InputJsonValue; match: Prisma.InputJsonValue; submittedBy: string | null; submittedAt: string | null };
type C = { legacyId: string; name: string | null; title: string | null; company: string | null; customerCode: string | null; phone: string | null; email: string | null; line: string | null; birthday: string | null };
type N = { uaid: string; sn: string; brand: string | null; model: string | null; type: string | null; customer: string | null; from: string[] };
(async () => {
  const mode = process.env.MODE ?? "dry";
  const d = JSON.parse(await readFile(process.env.FILE ?? ".dev-ops/legacy-1123.json", "utf8")) as { exported: string; docs: D[]; contacts: C[]; newAssets: N[]; taxInvoiceLast: number };
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const cust = new Map((await prisma.customer.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]));
  const asset = new Map((await prisma.asset.findMany({ select: { id: true, code: true } })).map((a) => [a.code, a.id]));
  const missC = [...new Set(d.docs.map((x) => x.customerCode).filter((c): c is string => !!c && !cust.has(c)))];
  const missA = [...new Set(d.docs.map((x) => x.assetCode).filter((c): c is string => !!c && !c.startsWith("NEW:") && !asset.has(c)))];
  if (missC.length || missA.length) throw new Error(`the file names records this database does not have: customers ${missC.join(",")} assets ${missA.join(",")}`);
  const have = await prisma.legacyDoc.count();
  const ti = await prisma.taxInvoice.count({ where: { seq: { not: null } } });
  const byKind = d.docs.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
  console.log(`docs ${d.docs.length} ${JSON.stringify(byKind)} · already there ${have} · new machines ${d.newAssets.length} · contacts ${d.contacts.filter((c) => c.customerCode && c.name).length}/${d.contacts.length} · real tax invoices issued here so far ${ti}`);
  if (mode !== "run") { console.log("DRY RUN"); process.exit(0); }

  const made: string[] = [];
  await prisma.$transaction(async (tx) => {
    // machines first: the reports point at them
    for (const n of d.newAssets) {
      const was = await tx.asset.findFirst({ where: { configuration: { path: ["renumberedFrom"], equals: n.uaid }, serialNumber: n.sn }, select: { id: true, code: true } });
      if (was) { asset.set(`NEW:${n.uaid}`, was.id); continue; }
      const owner = d.docs.find((x) => x.assetCode === `NEW:${n.uaid}`)?.customerCode;
      const code = await allocateNumber(tx, { prefix: "A", createdByEmployeeCode: md.code, entityId: entity.id });
      const a = await tx.asset.create({ data: { code, entityId: entity.id, type: /变频/.test(n.type ?? "") ? "VFD" : "OTHER", serialNumber: n.sn, customerId: owner ? cust.get(owner) : undefined, status: "IN_SERVICE", origin: "TAKEOVER",
        configuration: { renumberedFrom: n.uaid, legacy: { uaid: n.uaid, manufacturer: n.brand, model: n.model, type: n.type, customer: n.customer } } } });
      await tx.assetEvent.create({ data: { assetId: a.id, type: "ONBOARDED", actorId: md.id, summary: `导入 · 原系统 11-19 之后建档（${n.from.join("、")}）· 原编号 ${n.uaid} 在本系统已属于另一台，改为 ${code}`, payload: { origin: "TAKEOVER", import: "2026-11-23", renumberedFrom: n.uaid } } });
      asset.set(`NEW:${n.uaid}`, a.id); made.push(`${n.uaid}→${code}`);
    }
    await tx.legacyDoc.deleteMany({ where: { legacyId: { in: d.docs.map((x) => x.legacyId) } } });
    for (let i = 0; i < d.docs.length; i += 500) await tx.legacyDoc.createMany({ data: d.docs.slice(i, i + 500).map((x) => ({ legacyId: x.legacyId, kind: x.kind, form: x.form, no: x.no, docDate: x.date ? new Date(`${x.date}T00:00:00Z`) : undefined, title: x.title,
      customerId: x.customerCode ? cust.get(x.customerCode) : undefined, assetId: x.assetCode ? asset.get(x.assetCode) : undefined, amount: x.amount ?? undefined, currency: x.currency, refs: x.refs, data: x.data, match: x.match,
      submittedBy: x.submittedBy, submittedAt: x.submittedAt ? new Date(`${x.submittedAt.replace(" ", "T")}+08:00`) : undefined })) }); // 简道云 times are Beijing time
    let contacts = 0;
    for (const c of d.contacts) {
      const customerId = c.customerCode ? cust.get(c.customerCode) : undefined;
      if (!customerId || !c.name) continue;
      if (await tx.contact.findFirst({ where: { customerId, name: c.name }, select: { id: true } })) continue;
      await tx.contact.create({ data: { customerId, name: c.name, title: c.title, phone: c.phone, email: c.email, lineId: c.line, birthday: c.birthday } }); contacts++;
    }
    // ours carry on after the old system's last tax invoice — never set back below what has been issued here
    const run = await tx.docSequence.findUnique({ where: { entityId_prefix_period: { entityId: entity.id, prefix: "TI", period: TAX_INVOICE_RUN } } });
    if (!run) await tx.docSequence.create({ data: { entityId: entity.id, prefix: "TI", period: TAX_INVOICE_RUN, last: d.taxInvoiceLast } });
    else if (run.last < d.taxInvoiceLast) await tx.docSequence.update({ where: { id: run.id }, data: { last: d.taxInvoiceLast } });
    await tx.auditLog.create({ data: { actorId: md.id, action: "DATA_IMPORTED", target: "LEGACY_DOCS", detail: { by: "朱总 2026-11-23 11:31 · 简道云导出 " + d.exported, docs: byKind, newMachines: made, contacts, taxInvoiceCounter: d.taxInvoiceLast } } });
    console.log(`written: docs ${d.docs.length} · machines ${made.join(" ") || "none"} · contacts ${contacts} · tax invoice counter ${Math.max(run?.last ?? 0, d.taxInvoiceLast)}`);
  }, { timeout: 120000, maxWait: 20000 });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
