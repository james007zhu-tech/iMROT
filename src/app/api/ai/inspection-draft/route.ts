import { NextResponse } from "next/server";
import { draftInspection } from "@/server/ai";

/** POST { notes, locale } → structured INTH fields + list of missing mandatory items. */
export async function POST(req: Request) {
  try {
    const { notes, locale } = await req.json();
    return NextResponse.json(await draftInspection(String(notes), locale));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
