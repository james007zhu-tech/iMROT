/**
 * 数据范围 (需求清单 v3 第 1 节): the engineer sees the orders assigned to them, the supervisor those of their team,
 * and through them only the customers and documents those orders involve. MD, finance, sales and 内勤 see all; HR none.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, hasRole, noOrders, isApprover, rolesOf, type Who } from "@/lib/caps";

type Me = { id: string; role: string; extraRoles?: string[] | null; approver?: boolean | null };
const NONE = "__none__";

/** The people whose work this person sees: themselves, and for a supervisor everyone who reports to them. */
export async function teamIds(me: Me): Promise<string[]> {
  if (!isApprover(me) || hasRole(me, "MD")) return [me.id];
  const team = await prisma.employee.findMany({ where: { managerId: me.id }, select: { id: true } });
  return [me.id, ...team.map((t) => t.id)];
}

/** Prisma filter for the service orders this person may see. `{}` = all. */
export async function orderScope(me: Me): Promise<Prisma.ServiceOrderWhereInput> {
  if (can.allOrders(me)) return {};
  if (noOrders(me)) return { id: NONE };
  const ids = await teamIds(me);
  return { OR: [{ assigneeId: { in: ids } }, { createdById: { in: ids } }, { repairJobs: { some: { engineerId: { in: ids } } } }, { inspections: { some: { engineerId: { in: ids } } } }] };
}

/** Customers this person may see: for the shop floor, those of their orders. */
export async function customerScope(me: Me): Promise<Prisma.CustomerWhereInput> {
  if (can.customersAll(me)) return {};
  if (!hasRole(me, "ENGINEER")) return { id: NONE }; // HR, PUR: no customers
  return { serviceOrders: { some: await orderScope(me) } };
}

export async function mayOpenOrder(me: Me, orderId: string): Promise<boolean> {
  if (can.allOrders(me)) return true;
  return (await prisma.serviceOrder.count({ where: { id: orderId, ...(await orderScope(me)) } })) > 0;
}

/** For server actions on an order's pages: the person must be allowed to open that order. */
export async function assertOrderAccess(me: Me, orderNo: string) {
  const o = await prisma.serviceOrder.findUnique({ where: { no: orderNo }, select: { id: true } });
  if (o && !(await mayOpenOrder(me, o.id))) throw new Error("NO_PERMISSION");
}

/** Numbered documents a role may list, open and print. Financial papers and papers that carry the customer's price are not for the shop floor. */
const FIN_DOCS = ["TI", "IV", "RC", "BL", "PV", "CN", "DB", "PF"], PRICE_DOCS = ["QT", "PO"];
export function docTypeAllowed(who: Who, type: string): boolean {
  if (hasRole(who, "MD", "FINANCE")) return true;
  const ok = (r: string) => r === "SALES" ? type !== "PV"
    : r === "PURCHASING" ? !FIN_DOCS.includes(type) && type !== "QT" // POTH is theirs; the customer's price is not
    : r === "ENGINEER" ? !FIN_DOCS.includes(type) && !PRICE_DOCS.includes(type) : false; // HR: none
  return rolesOf(who).some(ok);
}
