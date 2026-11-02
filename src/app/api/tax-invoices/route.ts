import { NextResponse } from "next/server";
import { issueTaxInvoice } from "@/server/to";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await issueTaxInvoice(await req.json()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
