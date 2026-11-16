/**
 * 消息中心 — the reminders one person sees (rules: src/lib/notify.ts). Computed from the records on every page load,
 * so a message disappears when the work is done; nothing to mark as read.
 *  everyone:        their own orders (creator or engineer) — delivery date near/late, quote unanswered, not assigned,
 *                   project milestone late, maintenance due; customer contacts' birthdays
 *  MD/ADMIN/MANAGER: all orders; margin approvals; staff birthdays and expiring documents (MD)
 *  FINANCE (+MD):   customer invoices due, supplier invoices to pay
 */
import { can, scoped, hasRole } from "@/lib/caps";
import { paymentHold } from "@/server/srm";
import { orderScope, teamIds } from "@/server/scope";
import { openResetRequests } from "@/server/password-reset";
import { ensureCashPlan, mayPlan } from "@/server/cash-plan";
import { MD_LIMIT_THB, PAYROLL_ROLES } from "@/lib/pay-rules";
import { prisma } from "@/lib/db";
import { localToday } from "@/lib/overtime";
import { maskName } from "@/lib/mask";
import { daysToBirthday, daysUntil, orderDue, sortNotices, type Notice } from "@/lib/notify";

const OPEN = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] as const;

export async function noticesFor(me: { id: string; code: string; role: string }, today = new Date()): Promise<Notice[]> {
  const lead = hasRole(me, "MD");
  const money = can.finance(me);
  // whose orders: everything for the MD and 内勤; sales their own; the shop floor what is assigned to them (主管: their team); HR none
  const mine = lead ? {} : !can.allOrders(me) ? await orderScope(me) : { OR: [{ createdById: me.id }, { assigneeId: me.id }, { salesId: me.id }] };
  const team = scoped(me) ? await teamIds(me) : null;
  const soon = (n: number) => new Date(today.getTime() + n * 86_400_000);
  const out: Notice[] = [];
  const push = (kind: string, days: number, ref: string, href: string, who?: string) => out.push({ id: `${kind}:${ref}`, kind, level: days < 0 ? "late" : "soon", days, ref, who, href });

  const [orders, milestones, pm, contacts, invoices, payables, staff, creds] = await Promise.all([
    prisma.serviceOrder.findMany({ where: { status: { in: [...OPEN] }, ...mine }, select: { no: true, status: true, project: true, requestLines: true, quoteSentAt: true, reportedAt: true, assigneeId: true, marginApproval: true, priceHint: true, total: true, _count: { select: { lines: true } }, customer: { select: { name: true } } }, take: 400 }),
    prisma.projectMilestone.findMany({ where: { doneAt: null, plannedOn: { lt: soon(3) }, serviceOrder: { status: { in: [...OPEN] }, ...mine } }, select: { phase: true, plannedOn: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } }, take: 100 }),
    hasRole(me, "HR") || hasRole(me, "FINANCE") ? [] : prisma.repairJob.findMany({ where: { nextDueAt: { gte: soon(-60), lte: soon(14) }, ...(team ? { engineerId: { in: team } } : {}) }, orderBy: { nextDueAt: "desc" }, select: { no: true, assetId: true, nextDueAt: true, finishedAt: true, asset: { select: { code: true, customer: { select: { name: true } } } } }, take: 200 }),
    !can.customers(me) || hasRole(me, "FINANCE") ? [] : prisma.contact.findMany({ where: { birthday: { not: null } }, select: { id: true, name: true, birthday: true, customer: { select: { code: true, name: true } } } }),
    money ? prisma.invoice.findMany({ where: { paidAt: null, cancelledAt: null, dueAt: { lte: soon(3) } }, select: { no: true, dueAt: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } }, take: 200 }) : [],
    money ? prisma.supplierInvoice.findMany({ where: { status: "OPEN" }, select: { invoiceNo: true, invoiceDate: true, dueDate: true, accrued: true, mdApprovedAt: true, currency: true, payable: true, subtotal: true, matchDiff: true, supplier: { select: { name: true } }, purchaseOrder: { select: { no: true } } }, take: 300 }) : [],
    can.staff(me) ? prisma.employee.findMany({ where: { active: true, birthDate: { not: null } }, select: { code: true, name: true, birthDate: true } }) : [],
    can.staff(me) ? prisma.employeeCredential.findMany({ where: { expiresAt: { not: null, lte: soon(180) }, employee: { active: true } }, select: { kind: true, expiresAt: true, remindDays: true, employee: { select: { code: true, name: true } } } }) : [],
  ]);

  for (const o of orders) {
    const who = o.customer.name;
    const due = orderDue(o);
    if (due && daysUntil(due, today) <= 7) push("delivery", daysUntil(due, today), o.no, `/service-orders/${o.no}`, who);
    if (o.status === "QUOTE_PENDING" && o.quoteSentAt && daysUntil(o.quoteSentAt, today) <= -3) push("quoteWaiting", daysUntil(o.quoteSentAt, today), o.no, `/service-orders/${o.no}`, who);
    if (o.status === "RECEIVED" && !o.assigneeId && daysUntil(o.reportedAt, today) <= -1) push("unassigned", daysUntil(o.reportedAt, today), o.no, `/service-orders/${o.no}`, who);
    // 定价是销售和 MD 的事: items saved by the shop floor wait for a price; a word about the price waits to be read
    if (can.editPrice(me) && ["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(o.status) && o._count.lines > 0 && Number(o.total ?? 0) === 0) push("needsPrice", 0, o.no, `/service-orders/${o.no}/quote`, who);
    if (can.editPrice(me) && o.priceHint) push("priceHint", 0, o.no, `/service-orders/${o.no}/quote`, who);
    if (lead && hasRole(me, "MD") && o.marginApproval === "PENDING") push("marginApproval", 0, o.no, `/service-orders/${o.no}/quote`, who);
  }
  for (const m of milestones) push(`milestone`, daysUntil(m.plannedOn!, today), `${m.serviceOrder.no} ${m.phase}`, `/service-orders/${m.serviceOrder.no}/project`, m.serviceOrder.customer.name);
  // maintenance: only the latest visit of a machine counts
  const seen = new Set<string>();
  for (const j of pm) { if (seen.has(j.assetId)) continue; seen.add(j.assetId); push("maintenanceDue", daysUntil(j.nextDueAt!, today), j.asset.code, `/assets/${j.asset.code}`, j.asset.customer?.name); }
  for (const c of contacts) { const d = daysToBirthday(c.birthday, today); if (d != null && d <= 7) push("contactBirthday", d, maskName(c.name), `/customers/${c.customer.code}`, c.customer.name); }
  for (const i of invoices) push("receivable", daysUntil(i.dueAt!, today), i.no, `/service-orders/${i.serviceOrder.no}/payment`, i.serviceOrder.customer.name);
  // 应付提醒分三类 (需求清单 v3 P1-23): 票未到 — chase the supplier for the invoice; 待 MD 复批 — the MD's, not finance's;
  // 该付款了 — only what may be paid and falls due within 3 days.
  for (const p of payables) {
    if (p.accrued) { const waited = -daysUntil(p.invoiceDate, today); if (hasRole(me, "FINANCE") && waited >= 7) push("payableNoInvoice", -waited, p.purchaseOrder.no, `/purchasing/orders/${p.purchaseOrder.no}`, p.supplier.name); continue; }
    const hold = p.mdApprovedAt ? null : await paymentHold(p);
    if (hold) { if (hasRole(me, "MD")) push("payRelease", daysUntil(p.dueDate, today), p.invoiceNo, "/finance/payables", p.supplier.name); continue; }
    if (hasRole(me, "FINANCE") && daysUntil(p.dueDate, today) <= 3) push("payable", daysUntil(p.dueDate, today), p.invoiceNo, "/finance/payables", p.supplier.name);
  }
  for (const e of staff) { const d = daysToBirthday(e.birthDate, today); if (d != null && d <= 7) push("staffBirthday", d, e.name, `/people/${e.code}`); }
  for (const c of creds) { const d = daysUntil(c.expiresAt!, today); if (d <= c.remindDays) push("credential", d, `${c.employee.name} ${c.kind}`, `/people/${c.employee.code}`); }
  // 朱总 2026-11-11: last month's pay goes out by the 5th. From the 1st the MD is reminded until the month is paid.
  // 内勤 computes, 财务 reviews and pays, the MD approves: each is reminded only while the month waits for them.
  if (hasRole(me, ...PAYROLL_ROLES)) {
    const { previousMonth, date } = localToday();
    const { entityId } = await prisma.employee.findUniqueOrThrow({ where: { id: me.id }, select: { entityId: true } });
    const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId, month: previousMonth } }, select: { status: true, preparedBy: true, taxConfirmedAt: true } });
    const started = await prisma.salaryRecord.count({ where: { employee: { entityId, active: true } } });
    const turn = !run || !run.preparedBy ? "HR" : run.status === "DRAFT" ? (run.taxConfirmedAt ? "MD" : "FINANCE") : run.status === "APPROVED" ? "FINANCE" : null;
    if (started && turn && hasRole(me, turn)) push(`payrollDue_${!run || !run.preparedBy ? "prep" : run.status === "APPROVED" ? "pay" : turn === "MD" ? "approve" : "review"}`, 5 - Number(date.slice(8, 10)), previousMonth, run ? `/people/payroll/${previousMonth}` : `/people/payroll?month=${previousMonth}`);
  }
  // 付款复批: payments above the limit wait for the MD
  if (hasRole(me, "MD")) {
    // 作废待批: a tax invoice or a receipt someone asked to void
    for (const x of await prisma.taxInvoice.findMany({ where: { voidStatus: "REQUESTED" }, select: { no: true, voidRequestReason: true, serviceOrder: { select: { no: true } } }, take: 30 })) push("voidAsked", 0, x.no, `/service-orders/${x.serviceOrder.no}/invoice`, x.voidRequestReason ?? "");
    for (const x of await prisma.receipt.findMany({ where: { voidStatus: "REQUESTED", voidedAt: null }, select: { no: true, voidRequestReason: true, invoice: { select: { serviceOrder: { select: { no: true } } } } }, take: 30 })) push("voidAsked", 0, x.no, `/service-orders/${x.invoice.serviceOrder.no}/payment`, x.voidRequestReason ?? "");
    // (payments waiting for the MD are raised above, with the payables)
  }
  // 现金计划: the month's plan is written the first time anyone opens the system in that month; finance and the MD
  // are told for the first week
  if (mayPlan(me)) {
    const { date } = localToday(), month = date.slice(0, 7);
    const { entityId } = await prisma.employee.findUniqueOrThrow({ where: { id: me.id }, select: { entityId: true } });
    const made = await ensureCashPlan(entityId, month).catch(() => null);
    if (made && Number(date.slice(8, 10)) <= 7) push("cashPlanReady", 7 - Number(date.slice(8, 10)), month, `/finance/cash-plan?month=${month}`, Number((made.plan.totals as { out?: number }).out ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  }
  // 忘记密码: someone asked on the sign-in page; an MD issues the link from that person's ETH file
  if (hasRole(me, "MD")) for (const r of await openResetRequests()) push("resetAsked", 0, r.employee.code, `/people/${r.employee.code}#account`, r.employee.name);
  // someone locked out, and money waiting for the MD's word, are never pushed off the list by a long tail of late items
  const first = (n: Notice) => n.kind === "resetAsked" || n.kind === "payRelease" || n.kind === "voidAsked";
  const sorted = sortNotices(out);
  return [...sorted.filter(first), ...sorted.filter((n) => !first(n))].slice(0, 60);
}
