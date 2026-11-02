import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { readNameplate } from "@/server/ai";

/** POST multipart form with `photo` → proposed brand/series/model/serial (draft; the engineer confirms before saving). */
export async function POST(req: Request) {
  const denied = await requireSession(); if (denied) return denied;
  try {
    const form = await req.formData();
    const photo = form.get("photo") as File | null;
    if (!photo) return NextResponse.json({ error: "photo missing" }, { status: 400 });
    const b64 = Buffer.from(await photo.arrayBuffer()).toString("base64");
    return NextResponse.json(await readNameplate(b64, photo.type === "image/png" ? "image/png" : "image/jpeg"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
