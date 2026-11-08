import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { requireSession } from "@/server/api-auth";
import { prisma } from "@/lib/db";
import { createServiceOrder } from "@/server/slm";

/** GET /api/service-orders?status=&customerId= ; POST — 报修 → QTTH draft */
export async function GET(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  const u = new URL(req.url);
  const orders = await prisma.serviceOrder.findMany({
    where: { status: (u.searchParams.get("status") as never) ?? undefined, customerId: u.searchParams.get("customerId") ?? undefined },
    include: { customer: { select: { code: true, name: true } }, assignee: { select: { code: true, name: true } }, assets: { include: { asset: { select: { code: true, serialNumber: true } } } } },
    orderBy: { reportedAt: "desc" },
    take: 200,
  });
  return NextResponse.json(orders);
}

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const order = await createServiceOrder(await req.json());
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
