import { NextResponse } from "next/server";
import { getServiceOrder } from "@/server/slm";

export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
  const order = await getServiceOrder(no);
  return order ? NextResponse.json(order) : NextResponse.json({ error: "not found" }, { status: 404 });
}
