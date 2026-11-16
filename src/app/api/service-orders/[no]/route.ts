import { mayOpenOrder } from "@/server/scope";
import { jsonForSession, staffMe } from "@/server/api-auth";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { getServiceOrder } from "@/server/slm";

export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const denied = await requireSession(); if (denied) return denied;
  const { no } = await ctx.params;
  const order = await getServiceOrder(no);
  const me = await staffMe();
  if (order && !(me && (await mayOpenOrder(me, order.id)))) return NextResponse.json({ error: "NO_PERMISSION" }, { status: 403 });
  return order ? jsonForSession(order) : NextResponse.json({ error: "not found" }, { status: 404 });
}
