import { NextResponse } from "next/server";
import { similarCases } from "@/server/ai";

/** POST { modelId | seriesId, symptom, alarm, limit } → ranked past cases with their INTH/RPTH numbers. */
export async function POST(req: Request) {
  try {
    return NextResponse.json(await similarCases(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
