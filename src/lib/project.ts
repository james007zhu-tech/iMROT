/**
 * 自动化项目 (automation project, flow 自动化项目-流程图-v1, 2026-11-09). Pure rules shared by the plan page, the project
 * page, the quote and the tests.
 *
 * A project runs through nine milestones in order. Three of them carry a share of the contract and are invoiced when
 * they are done — by default 30 % at the contract, 60 % at delivery, 10 % at site acceptance (SAT); the MD/sales change
 * the split on the plan page, it must add up to 100 %. FAT and SAT need their test record uploaded; delivery needs a
 * signed DNTH; SAT accepts and locks the order. Whether the delivered cabinet becomes an ATH is still open (朱总) —
 * the project page offers "register as asset" after SAT, nothing is created automatically.
 */
export const PHASES = ["CONTRACT", "DESIGN", "PROCUREMENT", "BUILD", "FAT", "DELIVERY", "COMMISSIONING", "SAT", "HANDOVER"] as const;
export type Phase = (typeof PHASES)[number];

/** Default payment split (decided for the flow v1; editable per project). */
export const DEFAULT_PAY: Partial<Record<Phase, number>> = { CONTRACT: 0.3, DELIVERY: 0.6, SAT: 0.1 };
/** Phases whose completion needs evidence uploaded (test record, signed protocol). */
export const NEEDS_RECORD: readonly Phase[] = ["FAT", "SAT"];

export interface ProjectInfo { name: string; dueDate?: string; scope?: string; solution?: string; deliverables?: { name: string; qty: number }[]; labour?: { description: string; hours: number; costPerHour?: number }[] }
export type MilestoneShape = { seq: number; phase: string; payPct: number | null; doneAt: Date | string | null; taxInvoiceNo?: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function defaultMilestones(): { seq: number; phase: Phase; payPct: number | null }[] {
  return PHASES.map((phase, i) => ({ seq: i + 1, phase, payPct: DEFAULT_PAY[phase] ?? null }));
}

/** The split must be whole: shares between 0 and 100 % that add up to exactly 100 %. Error PAY_SPLIT:<sum %>. */
export function checkPaySplit(rows: { payPct: number | null }[]): void {
  const shares = rows.map((r) => r.payPct ?? 0);
  if (shares.some((p) => p < 0 || p > 1)) throw new Error("PAY_SPLIT:range");
  const sum = Math.round(shares.reduce((s, p) => s + p, 0) * 10000) / 100;
  if (sum !== 100) throw new Error(`PAY_SPLIT:${sum}`);
}

/** The milestone that can be completed now: the first not yet done (they run in order). */
export function nextMilestone<T extends MilestoneShape>(ms: T[]): T | null {
  return [...ms].sort((a, b) => a.seq - b.seq).find((m) => !m.doneAt) ?? null;
}

/** What stops this milestone from being marked done. */
export function milestoneBlockers(m: MilestoneShape, ms: MilestoneShape[], ctx: { files: number; signedDeliveries: number; orderStatus: string }): string[] {
  const out: string[] = [];
  if (m.doneAt) out.push("ALREADY_DONE");
  if (ms.some((x) => x.seq < m.seq && !x.doneAt)) out.push("EARLIER_OPEN");
  if (m.phase === "CONTRACT" && !["IN_PROGRESS", "ACCEPTANCE_PENDING", "ACCEPTED", "INVOICED"].includes(ctx.orderStatus)) out.push("NO_CUSTOMER_PO");
  if ((NEEDS_RECORD as readonly string[]).includes(m.phase) && ctx.files < 1) out.push("TEST_RECORD_REQUIRED");
  if (m.phase === "DELIVERY" && ctx.signedDeliveries < 1) out.push("DELIVERY_NOT_SIGNED");
  return out;
}

/**
 * Amount of a payment milestone, before VAT: its share of the quote subtotal. The last payment milestone takes what is
 * left, so the instalments always add up to the contract to the satang.
 */
export function milestoneAmount(m: MilestoneShape, ms: MilestoneShape[], subtotal: number): number {
  if (!m.payPct) return 0;
  const paying = [...ms].filter((x) => x.payPct).sort((a, b) => a.seq - b.seq);
  const last = paying[paying.length - 1];
  if (last && last.seq === m.seq) return r2(subtotal - paying.slice(0, -1).reduce((s, x) => s + r2(subtotal * (x.payPct ?? 0)), 0));
  return r2(subtotal * m.payPct);
}

/** Payment milestones done but not yet invoiced — the project page offers the TITH + IVTH for each. */
export const invoiceDue = <T extends MilestoneShape>(ms: T[]) => ms.filter((m) => m.payPct && m.doneAt && !m.taxInvoiceNo);
export const allInvoiced = (ms: MilestoneShape[]) => ms.filter((m) => m.payPct).every((m) => !!m.taxInvoiceNo);

/** "30% on contract / 60% on delivery / 10% on site acceptance" for the quotation's payment terms. */
export function paymentScheduleLines(ms: MilestoneShape[], names: Record<string, [string, string]>): string {
  return ms.filter((m) => m.payPct).sort((a, b) => a.seq - b.seq).map((m) => `${Math.round((m.payPct ?? 0) * 1000) / 10}%  ${names[m.phase]?.[0] ?? m.phase}  ${names[m.phase]?.[1] ?? ""}`.trim()).join("\n");
}

/** Bilingual milestone names for documents (EN, TH). */
export const PHASE_NAME: Record<Phase, [string, string]> = {
  CONTRACT: ["on contract / PO", "เมื่อทำสัญญา"], DESIGN: ["design", "ออกแบบ"], PROCUREMENT: ["procurement", "จัดซื้อ"], BUILD: ["assembly and programming", "ประกอบและเขียนโปรแกรม"],
  FAT: ["factory acceptance test", "ทดสอบที่โรงงาน"], DELIVERY: ["on delivery", "เมื่อส่งมอบ"], COMMISSIONING: ["installation and commissioning", "ติดตั้งและทดสอบเดินเครื่อง"],
  SAT: ["on site acceptance", "เมื่อตรวจรับหน้างาน"], HANDOVER: ["handover and training", "ส่งมอบและฝึกอบรม"],
};
