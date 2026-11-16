import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { prisma } from "@/lib/db";
import { onboardAsset } from "@/server/alm";

/** GET /api/assets?customerId=&status=&q=  — list; POST — onboard (建档/接管) */
export async function GET(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
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
  return jsonForSession(assets);
}

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const asset = await onboardAsset(await bodyAsSession(req));
    return jsonForSession(asset, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
