import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { requireSession } from "@/server/api-auth";
import { buildDashboardFromPrompt } from "@/server/ai";
import { currentEmployee } from "@/server/auth";

/** POST { prompt, dashboardId? } → the AI picks metrics from the catalog; saved as a new dashboard (or replaces the given one). */
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const me = await currentEmployee();
    const { prompt, dashboardId } = await req.json();
    const d = await buildDashboardFromPrompt(String(prompt), me.code, me.locale, dashboardId);
    return NextResponse.json({ id: d.id, name: d.name });
  } catch (e) { return NextResponse.json({ error: errorCode(e) }, { status: 400 }); }
}
