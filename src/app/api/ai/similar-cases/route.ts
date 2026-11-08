import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { requireSession } from "@/server/api-auth";
import { similarCases } from "@/server/ai";

/** POST { modelId | seriesId, symptom, alarm, limit } → ranked past cases with their INTH/RPTH numbers. */
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    return NextResponse.json(await similarCases(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
