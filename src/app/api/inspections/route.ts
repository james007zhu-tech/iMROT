import { NextResponse } from "next/server";
import { createInspection } from "@/server/slm-docs";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await createInspection(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
