import { orderScope } from "@/server/scope";
import { staffMe } from "@/server/api-auth";
import { NextResponse } from "next/server";
import { errorCode, errorStatus } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { prisma } from "@/lib/db";
import { createServiceOrder } from "@/server/slm";

/** GET /api/service-orders?status=&customerId= ; POST — 报修 → QTTH draft */
export async function GET(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  const u = new URL(req.url);
  const me = await staffMe();
  const orders = await prisma.serviceOrder.findMany({
    where: { AND: [me ? await orderScope(me) : { id: "__none__" }], status: (u.searchParams.get("status") as never) ?? undefined, customerId: u.searchParams.get("customerId") ?? undefined },
    include: { customer: { select: { code: true, name: true } }, assignee: { select: { code: true, name: true } }, assets: { include: { asset: { select: { code: true, serialNumber: true } } } } },
    orderBy: { reportedAt: "desc" },
    take: 200,
  });
  return jsonForSession(orders);
}

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const order = await createServiceOrder(await bodyAsSession(req));
    return jsonForSession(order, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: errorStatus(e) });
  }
}
