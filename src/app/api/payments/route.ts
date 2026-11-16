import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { recordPayment } from "@/server/to";

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    return jsonForSession(await recordPayment(await bodyAsSession(req)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
