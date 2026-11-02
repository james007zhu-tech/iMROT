import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/fx?currency=THB&date=2026-11-02 — latest BoC rate on or before the date */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const currency = u.searchParams.get("currency") ?? "THB";
  const date = u.searchParams.get("date") ? new Date(u.searchParams.get("date")!) : new Date();
  const rate = await prisma.fxRate.findFirst({ where: { currency, rateDate: { lte: date } }, orderBy: { rateDate: "desc" } });
  return rate ? NextResponse.json(rate) : NextResponse.json({ error: `no BOC rate for ${currency}` }, { status: 404 });
}
