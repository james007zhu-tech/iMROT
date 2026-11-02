import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [entities, assets, orders, lastRate] = await Promise.all([prisma.legalEntity.count(), prisma.asset.count(), prisma.serviceOrder.count(), prisma.fxRate.findFirst({ orderBy: { rateDate: "desc" }, select: { rateDate: true } })]);
    return NextResponse.json({ ok: true, version: process.env.npm_package_version ?? "dev", entities, assets, orders, lastFxRate: lastRate?.rateDate ?? null, ai: !!process.env.ANTHROPIC_API_KEY });
  } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 }); }
}
