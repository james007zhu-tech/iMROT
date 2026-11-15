/**
 * 钱的规矩 (朱总 2026-11-15, 测试报告 P0-14). Money leaves the company through the finance person only; nobody releases
 * what they raised themselves; one payment above the limit waits for the MD.
 */
export const MD_LIMIT_THB = 50_000;
/** Who may open the monthly payroll: 内勤 computes, 财务 reviews and pays, the MD approves. */
export const PAYROLL_ROLES = ["MD", "ADMIN", "FINANCE"];
export const overLimit = (amountThb: number | null) => amountThb == null || amountThb > MD_LIMIT_THB + 0.001;

/** 三单匹配: an invoice may differ from what was received by 1 % or 500 (whichever comes first) before the MD must look. */
export const mismatch = (diff: number | null | undefined, received: number) => diff != null && Math.abs(diff) > Math.min(500, Math.abs(received) * 0.01) + 0.005;
export const accrualNo = (poNo: string) => `暂估 ${poNo}`;
