import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assetsUsingPart, stockOnHand } from "@/server/scm";

/** GET /api/parts/:sku — the shared-spare view: stock on hand + every asset (any customer) that uses it */
export async function GET(_req: Request, ctx: { params: Promise<{ sku: string }> }) {
  const { sku } = await ctx.params;
  const part = await prisma.part.findUnique({ where: { sku }, include: { brand: true } });
  if (!part) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [onHand, assets] = await Promise.all([stockOnHand(sku), assetsUsingPart(sku)]);
  return NextResponse.json({ ...part, onHand, assets });
}
