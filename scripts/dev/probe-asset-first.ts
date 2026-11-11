/**
 * 设备优先 (朱总 2026-11-11) end to end: one serial number = one ATH; ERTH and INTH open from the machine with no QTTH;
 * the QTTH opened afterwards adopts them; with an open QTTH they attach at once; a person can move them.
 * Leaves its customer and machines in the trial data like the other probes.  npx tsx scripts/dev/probe-asset-first.ts
 */
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { onboardAsset } from "@/server/alm";
import { createInspection, receiveEquipment } from "@/server/slm-docs";
import { createServiceOrder } from "@/server/slm";
import { confirmSerial, looseDocsOf, relinkDoc } from "@/server/asset-first";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e) { return (e as Error).message.split("\n")[0]; } };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: process.env.PROBE_ACTOR ?? "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Asset First Co ${stamp}`, taxId: `01077${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const eng = await prisma.employee.findFirst({ where: { active: true, role: "ENGINEER" } });
  const base = { createdByEmployeeCode: md.code, type: "VFD" as const, customerId: customer.id, origin: "TAKEOVER" as const };

  const a = await onboardAsset({ ...base, serialNumber: `AF ${stamp}-a` });
  const twin = await refused(() => onboardAsset({ ...base, type: "MOTOR", serialNumber: `af${stamp}-A ` }));
  check("one serial number, one ATH — whatever the spacing, case or type", twin.startsWith(`ASSET_SERIAL_EXISTS:${a.code}`), twin);
  const none = await refused(() => onboardAsset({ ...base }));
  check("a machine without a serial number is refused unless the nameplate is declared missing", none === "SERIAL_REQUIRED", none);
  const b = await onboardAsset({ ...base, noSerial: true });
  check("nameplate missing: DCiT issues an internal serial number that names the ATH", b.serialNumber === `DCiT-${b.code}` && b.serialSource === "INTERNAL", b.serialNumber);
  if (eng) check("an internal serial number waits for a manager or the MD", (await refused(() => confirmSerial({ assetCode: b.code, actorCode: eng.code }))) === "SERIAL_CONFIRM_NEEDS_MANAGER");
  await confirmSerial({ assetCode: b.code, actorCode: md.code });

  // the machines arrive: no quote exists yet
  const er = await receiveEquipment({ actorCode: md.code, sender: "Khun A", items: [{ assetCode: a.code, accessories: "Keypad × 1", condition: "dusty", fault: "F30001", serialChecked: true }, { assetCode: b.code, accessories: "none", serialChecked: true }] });
  const erDoc = await prisma.document.findUniqueOrThrow({ where: { no: er.sourceDocNo! } });
  const evs = await prisma.assetEvent.findMany({ where: { sourceDocNo: erDoc.no } });
  check("one ERTH takes in two machines with no QTTH", /^ERTH\d{8}$/.test(erDoc.no) && evs.length === 2 && erDoc.serviceOrderId === null && evs.every((e) => e.serviceOrderId === null), erDoc.no);
  check("receiving records that the serial number was checked on the machine", !!(await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).serialVerifiedAt);
  const insp = await createInspection({ assetCode: a.code, engineerCode: md.code, findings: "IGBT short", probableCause: "cooling fan failed", conclusion: "repairable" });
  check("an INTH opens from the ATH with no QTTH", /^INTH\d{8}$/.test(insp.no) && insp.serviceOrderId === null, insp.no);
  check("the machine shows what no QTTH has claimed", (await looseDocsOf(a.id)).map((d) => d.no).sort().join() === [erDoc.no, insp.no].sort().join());

  // now the quote is opened for machine A: it adopts A's ERTH entry and INTH and starts at "diagnosed"
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [a.code], mode: "REPAIR", reportedSymptom: "F30001" });
  const after = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { inspections: true } });
  const evA = await prisma.assetEvent.findFirstOrThrow({ where: { sourceDocNo: erDoc.no, assetId: a.id } });
  check("the QTTH opened afterwards adopts the machine's ERTH and INTH", after.inspections.some((i) => i.no === insp.no) && evA.serviceOrderId === o.id && (await looseDocsOf(a.id)).length === 0, `${o.no} ← ${erDoc.no}, ${insp.no}`);
  check("…and starts where the work already stands", after.status === "DIAGNOSING", after.status);
  check("the other machine on that ERTH still waits for its own QTTH", (await looseDocsOf(b.id)).length === 1 && (await prisma.document.findUniqueOrThrow({ where: { no: erDoc.no } })).serviceOrderId === null);

  // machine B gets its order: from then on its ERTH and INTH attach at once
  const o2 = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [b.code], mode: "REPAIR", reportedSymptom: "no display" });
  const i2 = await createInspection({ assetCode: b.code, engineerCode: md.code, findings: "PSU dead" });
  check("with an open QTTH, an INTH opened from the ATH goes under it by itself", i2.serviceOrderId === o2.id, `${i2.no} → ${o2.no}`);
  const wrong = await refused(() => relinkDoc({ docNo: i2.no, orderNo: o.no, actorCode: md.code }));
  check("a document cannot be moved to an order its machine is not on", wrong.startsWith("RELINK_ASSET_NOT_ON_ORDER"), wrong);
  await relinkDoc({ docNo: i2.no, orderNo: null, actorCode: md.code });
  check("a person can take a document off the order the system chose…", (await prisma.inspection.findUniqueOrThrow({ where: { no: i2.no } })).serviceOrderId === null);
  await relinkDoc({ docNo: i2.no, orderNo: o2.no, actorCode: md.code });
  check("…and put it back", (await prisma.inspection.findUniqueOrThrow({ where: { no: i2.no } })).serviceOrderId === o2.id);
  const noAsset = await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [], mode: "REPAIR" }));
  check("a repair QTTH without an ATH is refused", noAsset === "ASSET_REQUIRED", noAsset);
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
