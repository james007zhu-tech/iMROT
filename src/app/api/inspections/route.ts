import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { bodyAsSession, jsonForSession, requireSession } from "@/server/api-auth";
import { createInspection } from "@/server/slm-docs";

export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    return jsonForSession(await createInspection(await bodyAsSession(req)), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
