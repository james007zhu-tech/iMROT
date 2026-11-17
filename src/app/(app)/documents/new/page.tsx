import { redirect } from "next/navigation";
import { DOC_PLACES } from "@/lib/doc-center";

/** /documents/new?type=IB → where that document is started (its own form, or the orders ready for it). */
export default async function NewDocument({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const type = (await searchParams).type ?? "";
  const place = DOC_PLACES[type];
  redirect(place?.newHref ?? (place ? `/documents?type=${type}&new=1` : "/documents"));
}
