import { ReceiveScreen } from "../../../_screens/receive";
import { loadOrder } from "../_shell";

export const dynamic = "force-dynamic";

/** 设备接收 ERTH as a step of a QTTH. The same form opens from the machines at /receiving/new. */
export default async function Receive({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  return <ReceiveScreen subject={order} self={`/service-orders/${no}/receive`} home={`/service-orders/${no}`} error={error} />;
}
