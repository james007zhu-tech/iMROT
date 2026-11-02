import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { createDashboard, listDashboards } from "@/server/dashboards";
import { currentEmployee } from "@/server/auth";

export async function GET() { return NextResponse.json(await listDashboards()); }
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const me = await currentEmployee();
    const b = await req.json();
    return NextResponse.json(await createDashboard(String(b.name ?? "Dashboard"), b.spec, me.code), { status: 201 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
