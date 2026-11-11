"use server";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { approvePayroll, computePayroll, markPayrollPaid, reopenPayroll, saveScores, setBands, type LineEdit } from "@/server/payroll";

const BACK = "/people/payroll";
const num = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s === "" ? undefined : Number(s); };

export async function computeAction(month: string) {
  await guarded(async () => { const me = await currentEmployee(); await computePayroll({ entityId: me.entityId, month, actorCode: me.code }); return { ok: month, to: `${BACK}/${month}` }; }, BACK);
}
/** The whole table is one form: bonus, other deduction, typed withholding and note per person. An empty withholding box means "compute it". */
export async function saveLinesAction(month: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const edits: Record<string, LineEdit> = {};
    for (const code of f.getAll("code").map(String)) edits[code] = { bonus: num(f.get(`bonus_${code}`)) ?? 0, otherDeduction: num(f.get(`other_${code}`)) ?? 0, whtManual: num(f.get(`wht_${code}`)) ?? null, note: String(f.get(`note_${code}`) ?? "").trim() };
    await computePayroll({ entityId: me.entityId, month, actorCode: me.code, edits });
  }, `${BACK}/${month}`);
}
export async function bandsAction(month: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const mins = f.getAll("min").map(Number), factors = f.getAll("factor").map(Number);
    await setBands({ entityId: me.entityId, month, actorCode: me.code, bands: mins.map((min, i) => ({ min, factor: factors[i] })).filter((b) => Number.isFinite(b.min) && Number.isFinite(b.factor)) });
  }, `${BACK}/${month}`);
}
export async function approveAction(month: string) {
  await guarded(async () => { const me = await currentEmployee(); await approvePayroll({ entityId: me.entityId, month, actorCode: me.code }); }, `${BACK}/${month}`);
}
export async function reopenAction(month: string) {
  await guarded(async () => { const me = await currentEmployee(); await reopenPayroll({ entityId: me.entityId, month, actorCode: me.code }); }, `${BACK}/${month}`);
}
export async function paidAction(month: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); const d = String(f.get("paidAt") ?? ""); await markPayrollPaid({ entityId: me.entityId, month, actorCode: me.code, paidAt: d ? new Date(d) : undefined }); }, `${BACK}/${month}`);
}
export async function scoresAction(month: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const scores = f.getAll("code").map(String).map((code) => ({ code, score: num(f.get(`score_${code}`)), conclusion: String(f.get(`why_${code}`) ?? "").trim() })).filter((s): s is { code: string; score: number; conclusion: string } => s.score !== undefined);
    const n = await saveScores({ actorCode: me.code, month, scores });
    return { ok: `${month} × ${n}`, to: `${BACK}?month=${month}` };
  }, `${BACK}?month=${month}`);
}
