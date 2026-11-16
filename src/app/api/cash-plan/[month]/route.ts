import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { buildCashPlan, mayPlan } from "@/server/cash-plan";

/** The month's cash plan as a spreadsheet file (CSV with a byte-order mark, so Excel reads the Thai and Chinese). */
export async function GET(_: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const code = await sessionEmployeeCode();
  const me = code ? await prisma.employee.findUnique({ where: { code } }) : null;
  if (!me || !mayPlan(me)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "bad month" }, { status: 400 });
  const plan = await buildCashPlan(me.entityId, month);
  const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["date", "direction", "kind", "party", "what", "reference", "currency", "amount", "overdue", "estimate"], ...plan.lines.map((l) => [l.date, l.dir, l.kind, l.party, l.what, l.ref ?? "", l.currency, l.amount.toFixed(2), l.overdue ? "yes" : "", l.estimate ? "yes" : ""]), [], ["", "", "", "", "TOTAL OUT (THB)", "", "THB", plan.totals.out.toFixed(2)], ["", "", "", "", "TOTAL IN (THB)", "", "THB", plan.totals.in.toFixed(2)], ["", "", "", "", "NET (THB)", "", "THB", plan.totals.net.toFixed(2)]];
  return new NextResponse("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="DCiT_cash_plan_${month}.csv"` } });
}
