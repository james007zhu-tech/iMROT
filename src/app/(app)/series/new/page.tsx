import SeriesPage from "../[id]/page";

export const dynamic = "force-dynamic";

export default async function NewSeries({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return SeriesPage({ params: Promise.resolve({ id: "new" }), searchParams });
}
