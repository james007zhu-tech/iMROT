import { NextResponse } from "next/server";
import { recordMovement } from "@/server/scm";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await recordMovement(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
