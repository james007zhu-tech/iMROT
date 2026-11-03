import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { isThaiTaxId, lookupDbd } from "@/server/dbd";

/** GET → normalized DBD company record for the new-customer form. Staff only. */
export async function GET(_: Request, { params }: { params: Promise<{ taxId: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { taxId } = await params;
  if (!isThaiTaxId(taxId)) return NextResponse.json({ error: "INVALID_TAX_ID" }, { status: 400 });
  try {
    const r = await lookupDbd(taxId);
    if (!r) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ...r, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: "LOOKUP_FAILED", detail: (e as Error).message }, { status: 502 });
  }
}
