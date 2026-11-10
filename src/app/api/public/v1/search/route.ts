import { publicSearch } from "@/server/knowledge";
import { langOf, options, publicJson } from "@/server/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  return publicJson(req, () => publicSearch(sp.get("q") ?? "", { brand: sp.get("brand") || undefined, series: sp.get("series") || undefined, lang: langOf(req) }));
}
