import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";
import { can, stripMoney } from "@/lib/caps";
import { docTypeAllowed, mayOpenOrder } from "@/server/scope";

/** For API routes: a 401 response when nobody is signed in, else null. Portal contacts count as signed in when `allowPortal`. */
export async function requireSession(allowPortal = false): Promise<NextResponse | null> {
  if (await sessionEmployeeCode()) return null;
  if (allowPortal && (await sessionContactId())) return null;
  return NextResponse.json({ error: "not signed in" }, { status: 401 });
}

export type SessionScope = { kind: "staff"; employeeCode: string } | { kind: "portal"; contactId: string; customerId: string };

/** Who is asking: staff (sees everything) or a portal contact (sees only `customerId`). null = not signed in. */
export async function sessionScope(): Promise<SessionScope | null> {
  const staff = await sessionEmployeeCode();
  if (staff) return { kind: "staff", employeeCode: staff };
  const id = await sessionContactId();
  if (!id) return null;
  const c = await prisma.contact.findUnique({ where: { id }, select: { id: true, customerId: true } });
  return c ? { kind: "portal", contactId: c.id, customerId: c.customerId } : null;
}

/** May this session read document `no`? Portal contacts only their own customer's (a document with no customer is staff-only). */
export async function canReadDocument(scope: SessionScope, no: string): Promise<boolean> {
  if (scope.kind === "staff") return staffMayReadDocument(no);
  const doc = await prisma.document.findUnique({ where: { no }, select: { customerId: true } });
  return !!doc && doc.customerId === scope.customerId;
}

/** The signed-in employee behind an API call, or null. */
export async function staffMe() {
  const code = await sessionEmployeeCode();
  return code ? prisma.employee.findUnique({ where: { code }, select: { id: true, code: true, role: true, entityId: true } }) : null;
}

/**
 * The request body with the actor set to whoever is signed in (需求清单 v3: 权限必须服务端强制). An API call acts as
 * its own session, never as the employee number it names — otherwise any role check behind it could be talked around.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the server functions behind the routes validate the body themselves (zod)
export async function bodyAsSession(req: Request): Promise<any> {
  const me = await sessionEmployeeCode();
  const body = (await req.json()) as Record<string, unknown>;
  if (!me) throw new Error("NO_PERMISSION");
  for (const k of ["actorCode", "actorEmployeeCode", "createdByEmployeeCode"]) if (k in body || k === "actorCode") body[k] = me;
  return body;
}

/** A JSON answer without the figures the asker's role may not see. */
export async function jsonForSession(data: unknown, init?: { status?: number }) {
  const me = await staffMe();
  return NextResponse.json(me ? stripMoney(JSON.parse(JSON.stringify(data)), me.role) : data, init);
}

/** Staff may read a numbered document when their role may see that kind and — for the shop floor — the order is theirs. */
export async function staffMayReadDocument(no: string): Promise<boolean> {
  const me = await staffMe();
  if (!me) return false;
  const doc = await prisma.document.findUnique({ where: { no }, select: { type: true, serviceOrderId: true, createdById: true } });
  if (!doc) return can.allOrders(me.role); // not a registered document number (e.g. a report rendered from an order): the order pages decide
  if (!docTypeAllowed(me.role, doc.type)) return false;
  if (can.allOrders(me.role)) return true;
  return doc.serviceOrderId ? mayOpenOrder(me, doc.serviceOrderId) : doc.createdById === me.id;
}
