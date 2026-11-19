import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { assetScope } from "@/server/scope";
import { pickRow } from "@/lib/asset-pick-row";

/**
 * GET /api/assets/pick?customer=<id>&q=  — the machines a new order can be about, for the picker (2026-11-19 import:
 * 14,839 machines, 8,762 at one customer — the form no longer carries them all). Same scope as the form itself.
 * Without a customer only a search finds anything; at most LIMIT rows, with the total so the picker can say "type more".
 */
const LIMIT = 300;
export async function GET(req: Request) {
  const me = await currentEmployee().catch(() => null);
  if (!me) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const u = new URL(req.url), customerId = u.searchParams.get("customer") || undefined, q = (u.searchParams.get("q") ?? "").trim();
  if (!customerId && q.length < 3) return NextResponse.json({ total: 0, rows: [] });
  const where = { AND: [await assetScope(me), { status: { not: "RETIRED" as const } }, customerId ? { customerId } : {},
    q ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { serialNumber: { contains: q.replace(/\s+/g, ""), mode: "insensitive" as const } }, { location: { contains: q, mode: "insensitive" as const } }, { model: { code: { contains: q, mode: "insensitive" as const } } }] } : {}] };
  const [total, list] = await Promise.all([prisma.asset.count({ where }), prisma.asset.findMany({ where, take: LIMIT, orderBy: [{ plant: { code: "asc" } }, { code: "asc" }],
    select: { code: true, serialNumber: true, location: true, customerId: true, customer: { select: { name: true } }, plant: { select: { code: true, name: true } }, model: { select: { code: true } } } })]);
  return NextResponse.json({ total, rows: list.map((a) => pickRow(a)) });
}
