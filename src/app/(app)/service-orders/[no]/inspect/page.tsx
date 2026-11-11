import { InspectScreen } from "../../../_screens/inspect";
import { loadOrder } from "../_shell";

export const dynamic = "force-dynamic";

/** 检测单 INTH as a step of a QTTH. The same form opens from the machine at /inspections/new. */
export default async function Inspect({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  return <InspectScreen subject={order} self={`/service-orders/${no}/inspect`} home={`/service-orders/${no}`} error={error} ok={ok} />;
}
