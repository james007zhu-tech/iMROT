import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { requireSession } from "@/server/api-auth";
import { draftInspection } from "@/server/ai";

/** POST { notes, locale } → structured INTH fields + list of missing mandatory items. */
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const { notes, locale } = await req.json();
    return NextResponse.json(await draftInspection(String(notes), locale));
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
