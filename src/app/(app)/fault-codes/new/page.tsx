import FaultCodePage from "../[id]/page";

export const dynamic = "force-dynamic";

/** New fault code — the same page as an existing one, with nothing filled in (?series= preselects the series). */
export default async function NewFaultCode({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; series?: string }> }) {
  return FaultCodePage({ params: Promise.resolve({ id: "new" }), searchParams });
}
