import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { requireSession } from "@/server/api-auth";
import { recordAcceptance } from "@/server/slm-docs";

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    return NextResponse.json(await recordAcceptance(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
