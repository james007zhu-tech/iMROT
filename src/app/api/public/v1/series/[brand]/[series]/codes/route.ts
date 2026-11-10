import { publicCodes } from "@/server/knowledge";
import { langOf, options, publicJson } from "@/server/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(req: Request, { params }: { params: Promise<{ brand: string; series: string }> }) {
  const { brand, series } = await params;
  const sp = new URL(req.url).searchParams;
  return publicJson(req, async () => {
    const r = await publicCodes(brand, series, { kind: sp.get("kind")?.toUpperCase() || undefined, page: Number(sp.get("page")) || 1, lang: langOf(req) });
    return r.total ? { brand, series, ...r } : null;
  });
}
