import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { appendAssetEvent } from "@/server/alm";

/** POST /api/assets/:code/events — append one event (optionally with a status transition) */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const denied = await requireSession(); if (denied) return denied;
  const { code } = await ctx.params;
  try {
    const ev = await appendAssetEvent({ assetCode: code, ...(await req.json()) });
    return NextResponse.json(ev, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
