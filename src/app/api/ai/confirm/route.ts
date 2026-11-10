import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { sessionEmployeeCode } from "@/server/auth";
import { decideAction } from "@/server/ai-actions";

/** POST { id, go } — the person confirms (or cancels) an action the assistant prepared. Staff only; owner only. */
export async function POST(req: Request) {
  const code = await sessionEmployeeCode();
  if (!code) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    const { id, go } = await req.json();
    return NextResponse.json(await decideAction(String(id), code, !!go));
  } catch (e) { return NextResponse.json({ error: errorCode(e) }, { status: 400 }); }
}
