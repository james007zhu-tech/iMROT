import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionScope } from "@/server/api-auth";

/** GET ?sn=… → the asset that already has this serial (case-insensitive), for the live warning on the new-asset form. Staff only. */
export async function GET(req: Request) {
  const scope = await sessionScope();
  if (!scope || scope.kind !== "staff") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const sn = new URL(req.url).searchParams.get("sn")?.trim();
  if (!sn) return NextResponse.json({ found: null });
  const a = await prisma.asset.findFirst({ where: { serialNumber: { equals: sn, mode: "insensitive" } }, select: { code: true, customer: { select: { name: true } }, plant: { select: { code: true } } } });
  return NextResponse.json({ found: a ? { code: a.code, where: `${a.customer?.name ?? ""}${a.plant ? ` · ${a.plant.code}` : ""}` } : null });
}
