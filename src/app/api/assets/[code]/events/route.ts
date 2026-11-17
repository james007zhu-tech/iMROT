import { NextResponse } from "next/server";
import { errorCode, errorStatus } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { appendAssetEvent } from "@/server/alm";

/** POST /api/assets/:code/events — append one event (optionally with a status transition) */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const denied = await requireSession(); if (denied) return denied;
  const { code } = await ctx.params;
  try {
    const ev = await appendAssetEvent({ assetCode: code, ...(await bodyAsSession(req)) });
    return jsonForSession(ev, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: errorStatus(e) });
  }
}
