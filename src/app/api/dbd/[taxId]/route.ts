import { NextResponse } from "next/server";
import { requireSession } from "@/server/api-auth";
import { lookupCompanyWeb } from "@/server/company-lookup";
import { DbdBlockedError, dbdWebUrl, isThaiTaxId, lookupDbd } from "@/server/dbd";

/** GET → normalized DBD company record for the new-customer form. Staff only. */
export async function GET(req: Request, { params }: { params: Promise<{ taxId: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { taxId } = await params;
  if (!isThaiTaxId(taxId)) return NextResponse.json({ error: "INVALID_TAX_ID" }, { status: 400 });
  // ?web=1 — the second pass: what the registry does not publish (address in English, phone), from the public web
  if (new URL(req.url).searchParams.get("web")) {
    const u = new URL(req.url).searchParams;
    const web = await lookupCompanyWeb(taxId, { nameTh: u.get("nameTh") ?? undefined, nameEn: u.get("nameEn") ?? undefined, addressTh: u.get("addressTh") ?? undefined }).catch(() => null);
    return NextResponse.json(web ?? { values: {}, sources: [] });
  }
  try {
    const r = await lookupDbd(taxId);
    if (!r) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ...r, fetchedAt: new Date().toISOString() });
  } catch (e) {
    // The DBD site's WAF refuses servers: not an outage on our side, so answer 200 with a reason and the page the person can open instead of a 502 in the console.
    if (e instanceof DbdBlockedError) return NextResponse.json({ error: "DBD_BLOCKED", openUrl: dbdWebUrl(taxId) });
    return NextResponse.json({ error: "LOOKUP_FAILED", detail: (e as Error).message, openUrl: dbdWebUrl(taxId) }, { status: 502 });
  }
}
