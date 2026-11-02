import { NextResponse } from "next/server";
import { buildDashboardFromPrompt } from "@/server/ai";
import { currentEmployee } from "@/server/auth";

/** POST { prompt, dashboardId? } → the AI picks metrics from the catalog; saved as a new dashboard (or replaces the given one). */
export async function POST(req: Request) {
  try {
    const me = await currentEmployee();
    const { prompt, dashboardId } = await req.json();
    const d = await buildDashboardFromPrompt(String(prompt), me.code, me.locale, dashboardId);
    return NextResponse.json({ id: d.id, name: d.name });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
