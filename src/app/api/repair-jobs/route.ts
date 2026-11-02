import { NextResponse } from "next/server";
import { createRepairJob } from "@/server/slm-docs";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await createRepairJob(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
