import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { codesFrom } from "@/lib/asset-pick";
import { AssetPick } from "@/components/AssetPick";
import { Flash } from "@/components/Flash";
import { PageHeader } from "@/components/ui";
import { openOrderFor } from "@/server/asset-first";
import { getServiceOrder } from "@/server/slm";
import { InspectScreen } from "../../_screens/inspect";
import { assetSubject } from "../../service-orders/[no]/_shell";

export const dynamic = "force-dynamic";

/**
 * 新建检测单 INTH — from the machine (设备优先). Pick the ATH; when the machine already has an open QTTH the form
 * stands on that order (its symptom, its engineer), otherwise on the machine alone.
 */
export default async function NewInspection({ searchParams }: { searchParams: Promise<{ asset?: string | string[]; q?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const [u, n] = await Promise.all([getTranslations("ui"), getTranslations("nav")]);
  const code = codesFrom(sp.asset)[0];
  const back = { href: "/service-reports?kind=inspection", label: n("inspectionReports") };
  const asset = code ? await prisma.asset.findUnique({ where: { code }, select: { id: true, code: true } }) : null;
  if (asset) {
    const self = `/inspections/new?asset=${asset.code}`;
    const open = await openOrderFor(prisma, asset.id);
    const order = open ? await getServiceOrder(open.no) : null;
    // on an order with several machines the form still opens on the one that was picked
    if (order) return <InspectScreen subject={{ ...order, assets: [...order.assets].sort((a, b) => Number(b.assetId === asset.id) - Number(a.assetId === asset.id)), back: { href: `/assets/${asset.code}`, label: asset.code } }} self={self} home={`/service-orders/${order.no}`} error={sp.error} ok={sp.ok} />;
    const subject = await assetSubject([asset.code], { href: `/assets/${asset.code}`, label: asset.code });
    if (subject) return <InspectScreen subject={subject} self={self} home={`/assets/${asset.code}`} error={sp.error} ok={sp.ok} />;
  }
  return (
    <div className="space-y-4">
      <PageHeader back={back} title={u("newInth")} />
      <Flash error={sp.error} />
      <AssetPick to="/inspections/new" param="asset" q={sp.q} title={u("pickForInth")} hint={u("pickForInthHint")} />
    </div>
  );
}
