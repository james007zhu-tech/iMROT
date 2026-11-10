import { publicSeries } from "@/server/knowledge";
import { options, publicJson } from "@/server/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(req: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  return publicJson(req, async () => { const items = await publicSeries(brand); return items.length ? { brand, items } : null; });
}
