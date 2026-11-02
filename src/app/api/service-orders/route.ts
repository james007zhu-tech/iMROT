import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createServiceOrder } from "@/server/slm";

/** GET /api/service-orders?status=&customerId= ; POST — 报修 → QTTH draft */
export async function GET(req: Request) {
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
  try {
    const order = await createServiceOrder(await req.json());
    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
