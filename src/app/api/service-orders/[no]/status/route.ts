import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { advanceServiceOrder } from "@/server/slm";

/** POST { to, actorEmployeeCode, note } — move the order along the nine-step status line */
export async function POST(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const denied = await requireSession(); if (denied) return denied;
  const { no } = await ctx.params;
  try {
    const body = await req.json();
    return NextResponse.json(await advanceServiceOrder(no, body.to, body.actorEmployeeCode, body.note));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
