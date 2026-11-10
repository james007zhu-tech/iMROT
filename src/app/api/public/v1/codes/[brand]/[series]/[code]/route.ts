import { publicCode } from "@/server/knowledge";
import { langOf, options, publicJson } from "@/server/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(req: Request, { params }: { params: Promise<{ brand: string; series: string; code: string }> }) {
  const { brand, series, code } = await params;
  return publicJson(req, () => publicCode(brand, series, decodeURIComponent(code), langOf(req)));
}
