import { publicBrands } from "@/server/knowledge";
import { options, publicJson } from "@/server/public-api";

export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(req: Request) { return publicJson(req, async () => ({ items: await publicBrands() })); }
