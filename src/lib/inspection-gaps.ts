/**
 * What an INTH draft still lacks (wireframe 6: "缺失项 — 测量值、仪器、隔离确认、客户授权"). Plain rules, so it works
 * without the AI and the engineer sees the same list every time; it advises, it never blocks the save.
 */
export type GapKey = "gap_conditions" | "gap_isolation" | "gap_findings" | "gap_cause" | "gap_recommendation" | "gap_authorization" | "gap_tests" | "gap_evidence" | "gap_instruments";
type Test = { test: string; result?: string | null; recordId?: string | null };
type Insp = { conditions?: string | null; findings?: string | null; probableCause?: string | null; recommendation?: string | null; instruments?: string | null; tests?: Test[] | null };

const ISOLATION = /断电|停电|挂牌|上锁|隔离|验电|LOTO|lock.?out|tag.?out|isolat|de-?energi|ปิดไฟ|ตัดไฟ|ล็อก/i;
const AUTHORISATION = /授权|批准|同意|报价|确认|author|approv|consent|quote|อนุมัติ|ยืนยัน|ใบเสนอราคา/i;
const blank = (s?: string | null) => !s || !s.trim();

export function inspectionGaps(i: Insp): { key: GapKey; detail?: string }[] {
  const gaps: { key: GapKey; detail?: string }[] = [];
  if (blank(i.conditions)) gaps.push({ key: "gap_conditions" });
  else if (!ISOLATION.test(i.conditions!)) gaps.push({ key: "gap_isolation" });
  if (blank(i.findings)) gaps.push({ key: "gap_findings" });
  if (blank(i.probableCause)) gaps.push({ key: "gap_cause" });
  if (blank(i.recommendation)) gaps.push({ key: "gap_recommendation" });
  else if (!AUTHORISATION.test(i.recommendation!)) gaps.push({ key: "gap_authorization" });
  const measured = (i.tests ?? []).filter((t) => !blank(t.result));
  if (!measured.length) gaps.push({ key: "gap_tests" });
  const noEvidence = measured.filter((t) => blank(t.recordId)).map((t) => t.test);
  if (noEvidence.length) gaps.push({ key: "gap_evidence", detail: noEvidence.join("、") });
  if (blank(i.instruments)) gaps.push({ key: "gap_instruments" });
  return gaps;
}
