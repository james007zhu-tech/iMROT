import { getTranslations } from "next-intl/server";
import { codesFrom } from "@/lib/asset-pick";
import { AssetPick } from "@/components/AssetPick";
import { Flash } from "@/components/Flash";
import { PageHeader } from "@/components/ui";
import { ReceiveScreen } from "../../_screens/receive";
import { assetSubject } from "../../service-orders/[no]/_shell";

export const dynamic = "force-dynamic";

/** 新建设备接收单 ERTH — from the machines (设备优先). Pick the ATH numbers first; no QTTH is needed. */
export default async function NewReceiving({ searchParams }: { searchParams: Promise<{ a?: string | string[]; q?: string; error?: string }> }) {
  const sp = await searchParams;
  const [u, n] = await Promise.all([getTranslations("ui"), getTranslations("nav")]);
  const codes = codesFrom(sp.a);
  const back = { href: "/documents?type=ER", label: n("receiving") };
  const subject = codes.length ? await assetSubject(codes, back) : null;
  if (subject) {
    const mixed = new Set(subject.assets.map((l) => l.asset.customerId)).size > 1;
    if (!mixed) return <ReceiveScreen subject={subject} self={`/receiving/new?a=${codes.join(",")}`} home={subject.assets.length === 1 ? `/assets/${subject.assets[0].asset.code}` : "/documents?type=ER"} error={sp.error} />;
  }
  return (
    <div className="space-y-4">
      <PageHeader back={back} title={u("newErth")} />
      <Flash error={sp.error ?? (codes.length ? "RECEIVE_ONE_CUSTOMER" : undefined)} />
      <AssetPick to="/receiving/new" param="a" multi q={sp.q} title={u("pickForErth")} hint={u("pickForErthHint")} />
    </div>
  );
}
