import { NextResponse } from "next/server";
import { recordAcceptance } from "@/server/slm-docs";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await recordAcceptance(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
