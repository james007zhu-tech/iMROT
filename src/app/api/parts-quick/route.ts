import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { prisma } from "@/lib/db";
import { createPart, findPart } from "@/server/scm";
import { guessBrand } from "@/lib/part-guess";

/** GET /api/parts-quick?text=… — the brands, and the brand the text (a POTH or quote line) most likely names. */
export async function GET(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } });
  const text = new URL(req.url).searchParams.get("text") ?? "";
  return NextResponse.json({ brands, guess: guessBrand(text, brands) });
}

/** POST /api/parts-quick — 原地新建料号: a part made where it is needed. The same maker's number is never made twice. */
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { brandCode?: string; vendorPartNo?: string; name?: string; unit?: string };
  const vendor = (b.vendorPartNo ?? "").trim(), name = (b.name ?? "").trim();
  if (!vendor) return NextResponse.json({ error: "PART_NEEDS_NUMBER" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "PART_NEEDS_NAME" }, { status: 400 });
  const have = await findPart(vendor).catch(() => null);
  const part = have ?? (await createPart({ brandCode: b.brandCode || undefined, vendorPartNo: vendor, name, unit: b.unit || "pcs" }));
  return NextResponse.json({ sku: part.sku, vendorPartNo: part.vendorPartNo, name: part.name, nameLocal: part.nameLocal, unit: part.unit, existed: !!have });
}
