import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";

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
  if (scope.kind === "staff") return true;
  const doc = await prisma.document.findUnique({ where: { no }, select: { customerId: true } });
  return !!doc && doc.customerId === scope.customerId;
}
