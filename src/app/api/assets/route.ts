import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { onboardAsset } from "@/server/alm";

/** GET /api/assets?customerId=&status=&q=  — list; POST — onboard (建档/接管) */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? undefined;
  const assets = await prisma.asset.findMany({
    where: {
      customerId: u.searchParams.get("customerId") ?? undefined,
      status: (u.searchParams.get("status") as never) ?? undefined,
      OR: q ? [{ code: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] : undefined,
    },
    include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { code: true, name: true } }, plant: { select: { code: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(assets);
}

export async function POST(req: Request) {
  try {
    const asset = await onboardAsset(await req.json());
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
