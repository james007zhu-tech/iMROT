/**
 * 消息中心 — the reminders one person sees (rules: src/lib/notify.ts). Computed from the records on every page load,
 * so a message disappears when the work is done; nothing to mark as read.
 *  everyone:        their own orders (creator or engineer) — delivery date near/late, quote unanswered, not assigned,
 *                   project milestone late, maintenance due; customer contacts' birthdays
 *  MD/ADMIN/MANAGER: all orders; margin approvals; staff birthdays and expiring documents (MD)
 *  FINANCE (+MD):   customer invoices due, supplier invoices to pay
 */
import { prisma } from "@/lib/db";
import { localToday } from "@/lib/overtime";
import { maskName } from "@/lib/mask";
import { daysToBirthday, daysUntil, orderDue, sortNotices, type Notice } from "@/lib/notify";

const OPEN = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] as const;

export async function noticesFor(me: { id: string; code: string; role: string }, today = new Date()): Promise<Notice[]> {
  const lead = ["MD", "ADMIN", "MANAGER"].includes(me.role);
  const money = ["MD", "FINANCE"].includes(me.role);
  const mine = lead ? {} : { OR: [{ createdById: me.id }, { assigneeId: me.id }, { salesId: me.id }] };
  const soon = (n: number) => new Date(today.getTime() + n * 86_400_000);
  const out: Notice[] = [];
  const push = (kind: string, days: number, ref: string, href: string, who?: string) => out.push({ id: `${kind}:${ref}`, kind, level: days < 0 ? "late" : "soon", days, ref, who, href });

  const [orders, milestones, pm, contacts, invoices, payables, staff, creds] = await Promise.all([
    prisma.serviceOrder.findMany({ where: { status: { in: [...OPEN] }, ...mine }, select: { no: true, status: true, project: true, requestLines: true, quoteSentAt: true, reportedAt: true, assigneeId: true, marginApproval: true, customer: { select: { name: true } } }, take: 400 }),
    prisma.projectMilestone.findMany({ where: { doneAt: null, plannedOn: { lt: soon(3) }, serviceOrder: { status: { in: [...OPEN] }, ...mine } }, select: { phase: true, plannedOn: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } }, take: 100 }),
    prisma.repairJob.findMany({ where: { nextDueAt: { gte: soon(-60), lte: soon(14) } }, orderBy: { nextDueAt: "desc" }, select: { no: true, assetId: true, nextDueAt: true, finishedAt: true, asset: { select: { code: true, customer: { select: { name: true } } } } }, take: 200 }),
    prisma.contact.findMany({ where: { birthday: { not: null } }, select: { id: true, name: true, birthday: true, customer: { select: { code: true, name: true } } } }),
    money ? prisma.invoice.findMany({ where: { paidAt: null, cancelledAt: null, dueAt: { lte: soon(3) } }, select: { no: true, dueAt: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } }, take: 200 }) : [],
    money ? prisma.supplierInvoice.findMany({ where: { status: "OPEN", dueDate: { lte: soon(7) } }, select: { invoiceNo: true, dueDate: true, supplier: { select: { name: true } } }, take: 200 }) : [],
    me.role === "MD" ? prisma.employee.findMany({ where: { active: true, birthDate: { not: null } }, select: { code: true, name: true, birthDate: true } }) : [],
    me.role === "MD" ? prisma.employeeCredential.findMany({ where: { expiresAt: { not: null, lte: soon(180) }, employee: { active: true } }, select: { kind: true, expiresAt: true, remindDays: true, employee: { select: { code: true, name: true } } } }) : [],
  ]);

  for (const o of orders) {
    const who = o.customer.name;
    const due = orderDue(o);
    if (due && daysUntil(due, today) <= 7) push("delivery", daysUntil(due, today), o.no, `/service-orders/${o.no}`, who);
    if (o.status === "QUOTE_PENDING" && o.quoteSentAt && daysUntil(o.quoteSentAt, today) <= -3) push("quoteWaiting", daysUntil(o.quoteSentAt, today), o.no, `/service-orders/${o.no}`, who);
    if (o.status === "RECEIVED" && !o.assigneeId && daysUntil(o.reportedAt, today) <= -1) push("unassigned", daysUntil(o.reportedAt, today), o.no, `/service-orders/${o.no}`, who);
    if (lead && me.role === "MD" && o.marginApproval === "PENDING") push("marginApproval", 0, o.no, `/service-orders/${o.no}/quote`, who);
  }
  for (const m of milestones) push(`milestone`, daysUntil(m.plannedOn!, today), `${m.serviceOrder.no} ${m.phase}`, `/service-orders/${m.serviceOrder.no}/project`, m.serviceOrder.customer.name);
  // maintenance: only the latest visit of a machine counts
  const seen = new Set<string>();
  for (const j of pm) { if (seen.has(j.assetId)) continue; seen.add(j.assetId); push("maintenanceDue", daysUntil(j.nextDueAt!, today), j.asset.code, `/assets/${j.asset.code}`, j.asset.customer?.name); }
  for (const c of contacts) { const d = daysToBirthday(c.birthday, today); if (d != null && d <= 7) push("contactBirthday", d, maskName(c.name), `/customers/${c.customer.code}`, c.customer.name); }
  for (const i of invoices) push("receivable", daysUntil(i.dueAt!, today), i.no, `/service-orders/${i.serviceOrder.no}/payment`, i.serviceOrder.customer.name);
  for (const p of payables) push("payable", daysUntil(p.dueDate, today), p.invoiceNo, "/finance/payables", p.supplier.name);
  for (const e of staff) { const d = daysToBirthday(e.birthDate, today); if (d != null && d <= 7) push("staffBirthday", d, e.name, `/people/${e.code}`); }
  for (const c of creds) { const d = daysUntil(c.expiresAt!, today); if (d <= c.remindDays) push("credential", d, `${c.employee.name} ${c.kind}`, `/people/${c.employee.code}`); }
  // 朱总 2026-11-11: last month's pay goes out by the 5th. From the 1st the MD is reminded until the month is paid.
  if (me.role === "MD") {
    const { previousMonth, date } = localToday();
    const { entityId } = await prisma.employee.findUniqueOrThrow({ where: { id: me.id }, select: { entityId: true } });
    const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId, month: previousMonth } }, select: { status: true } });
    const started = await prisma.salaryRecord.count({ where: { employee: { entityId, active: true } } });
    if (started && run?.status !== "PAID") push("payrollDue", 5 - Number(date.slice(8, 10)), previousMonth, run ? `/people/payroll/${previousMonth}` : `/people/payroll?month=${previousMonth}`);
  }
  return sortNotices(out).slice(0, 60);
}
