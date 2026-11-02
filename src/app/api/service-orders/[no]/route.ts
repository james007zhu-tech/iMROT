import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { getServiceOrder } from "@/server/slm";

export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const denied = await requireSession(); if (denied) return denied;
  const { no } = await ctx.params;
  const order = await getServiceOrder(no);
  return order ? NextResponse.json(order) : NextResponse.json({ error: "not found" }, { status: 404 });
}
