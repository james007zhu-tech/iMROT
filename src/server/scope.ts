/**
 * 数据范围 (需求清单 v3 第 1 节): the engineer sees the orders assigned to them, the supervisor those of their team,
 * and through them only the customers and documents those orders involve. MD, finance, sales and 内勤 see all; HR none.
 */
import { FIN_DOC_TYPES } from "@/lib/caps";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, hasRole, noOrders, isApprover, rolesOf, type Who, menuAllows } from "@/lib/caps";
import { DOC_PLACES } from "@/lib/doc-center";

type Me = { id: string; role: string; extraRoles?: string[] | null; approver?: boolean | null };
const NONE = "__none__";

/** The people whose work this person sees: themselves, and for a supervisor everyone who reports to them. */
export async function teamIds(me: Me): Promise<string[]> {
  if (!isApprover(me) || hasRole(me, "MD")) return [me.id];
  const team = await prisma.employee.findMany({ where: { managerId: me.id }, select: { id: true } });
  return [me.id, ...team.map((t) => t.id)];
}

/**
 * Prisma filter for the service orders this person may see. `{}` = all (MD, FIN, PUR).
 * ENG: assigned to them or their team. Sales: the customers they are responsible for, and the orders that are theirs.
 * Several roles: either. HR: none. (需求清单 v4 V4-P0-02)
 */
export async function orderScope(me: Me): Promise<Prisma.ServiceOrderWhereInput> {
  if (can.allOrders(me)) return {};
  return ownOrders(me);
}
/** The orders that are this person's as Sales or as engineer — whatever else they may see through another role. */
async function ownOrders(me: Me): Promise<Prisma.ServiceOrderWhereInput> {
  const or: Prisma.ServiceOrderWhereInput[] = [];
  if (hasRole(me, "SALES")) or.push({ salesId: me.id }, { createdById: me.id }, { customer: { salesId: me.id } });
  if (hasRole(me, "ENGINEER")) { const ids = await teamIds(me); or.push({ assigneeId: { in: ids } }, { createdById: { in: ids } }, { repairJobs: { some: { engineerId: { in: ids } } } }, { inspections: { some: { engineerId: { in: ids } } } }); }
  return or.length ? { OR: or } : { id: NONE };
}

/** Customers this person may see: Sales their own; the shop floor those of their orders; HR and PUR none. */
export async function customerScope(me: Me): Promise<Prisma.CustomerWhereInput> {
  if (can.customersAll(me)) return {};
  const or: Prisma.CustomerWhereInput[] = [];
  if (hasRole(me, "SALES")) or.push({ salesId: me.id });
  if (hasRole(me, "SALES", "ENGINEER")) or.push({ serviceOrders: { some: await ownOrders(me) } });
  return or.length ? { OR: or } : { id: NONE };
}

/** Assets (machines) this person may see: those of the customers they may see. */
export async function assetScope(me: Me): Promise<Prisma.AssetWhereInput> {
  if (can.customersAll(me)) return {};
  const c = await customerScope(me);
  return "id" in c && c.id === NONE ? { id: NONE } : { OR: [{ customer: c }, { orderLinks: { some: { serviceOrder: await ownOrders(me) } } }] };
}

export async function mayOpenOrder(me: Me, orderId: string): Promise<boolean> {
  if (can.allOrders(me)) return true;
  return (await prisma.serviceOrder.count({ where: { id: orderId, ...(await orderScope(me)) } })) > 0;
}

/**
 * 验收签字 (需求清单 v4 V4-P0-03): the order's engineer, their approver, the Sales person of the order, or the MD.
 * FIN, PUR and HR read the acceptance; they never sign it.
 */
export async function mayAccept(me: Me, orderId: string): Promise<boolean> {
  if (hasRole(me, "MD")) return true;
  if (!hasRole(me, "SALES", "ENGINEER")) return false;
  return (await prisma.serviceOrder.count({ where: { AND: [{ id: orderId }, await ownOrders(me)] } })) > 0;
}

/** For server actions on an order's pages: the person must be allowed to open that order. */
export async function assertOrderAccess(me: Me, orderNo: string) {
  const o = await prisma.serviceOrder.findUnique({ where: { no: orderNo }, select: { id: true } });
  if (o && !(await mayOpenOrder(me, o.id))) throw new Error("NO_PERMISSION");
}

/**
 * Numbered documents a person may list, open and print: the same table as the menu (需求清单 v4 V4-P0-04) — a kind is
 * theirs when its menu entry is. PUR: PR, PO, IB, OB, DN. FIN: all. ENG: their reports and their own OB. Sales: theirs
 * except payment vouchers. HR: none.
 */
export function docTypeAllowed(who: Who, type: string): boolean {
  if (hasRole(who, "MD")) return true;
  if (type === "QT" && !can.price(who)) return false; // the quote paper carries the customer's price
  if (FIN_DOC_TYPES.includes(type) && !can.invoiceStatus(who)) return false; // N-32: 税票、请款、收据、贷项 — finance, the MD, the customer's sales
  const place = DOC_PLACES[type];
  return !!place && menuAllows(who, place.nav);
}
