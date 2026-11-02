import { NextResponse } from "next/server";
import { getAssetPage, transferAsset } from "@/server/alm";

/** GET /api/assets/ATH26110001 — the whole asset page (header, timeline, orders, relations, model knowledge) */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const asset = await getAssetPage(code);
  return asset ? NextResponse.json(asset) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** PATCH — transfer only (customer / plant / location). ATH and serial are immutable. */
export async function PATCH(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  try {
    const body = await req.json();
    const ev = await transferAsset({ assetCode: code, ...body });
    return NextResponse.json(ev);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
