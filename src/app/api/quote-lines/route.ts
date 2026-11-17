import { NextResponse } from "next/server";
import { errorCode, errorStatus } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { setQuoteLines } from "@/server/slm-docs";

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    return jsonForSession(await setQuoteLines(await bodyAsSession(req)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: errorStatus(e) });
  }
}
