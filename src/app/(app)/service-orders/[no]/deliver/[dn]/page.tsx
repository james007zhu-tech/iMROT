import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { signDelivery } from "@/server/delivery";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, Table, Tag, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, str } from "../../_shell";

export const dynamic = "force-dynamic";

/** One DNTH: print it, then record the customer's signature (on the phone or a photo of the signed copy). */
export default async function DeliveryNote({ params, searchParams }: { params: Promise<{ no: string; dn: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no, dn }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const note = await prisma.deliveryNote.findUnique({ where: { no: dn }, include: { driver: true } });
  if (!note || note.serviceOrderId !== order.id) notFound();
  const [t, u, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getLocale()]);
  const lines = note.lines as { key: string; kind: string; poLineNo?: number; description: string; assetCode?: string; delivered: number; source?: string; isService?: boolean }[];
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  async function sign(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await signDelivery({ no: dn, actorCode: me.code, signedBy: String(f.get("signedBy")), signedAt: str(f, "signedAt") ? new Date(str(f, "signedAt")!) : undefined, remark: str(f, "remark"), attachments: atts(f) });
      return { ok: dn, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/deliver/${dn}`);
  }
  const signed = note.status === "SIGNED";
  return (
    <StepPage order={order} title={<span className="font-mono">{note.no}</span>} badge={<Tag hot={!signed}>{u(`dn_${note.status}`)}</Tag>} error={error} ok={ok}
      kind={signed ? undefined : "delivery"} uploadTitle={u("upSignedTitle")} uploadHint={u("upSignedHint")} saveLabel={signed ? "" : u("recordSignature")}
      extraActions={<a href={`/api/documents/${note.no}/render?format=pdf`} className="inline-flex min-h-10 items-center rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">{u("printDeliveryNote")}</a>}>
      <Card title={u("deliveryContent")}>
        <p className="text-[13px] text-navy/80">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(note.deliverOn)} · {note.driver ? `${note.driver.code} ${note.driver.name}` : ""}{note.vehicle ? ` · ${note.vehicle}` : ""}</p>
        <Table head={[u("poLine"), u("item"), t("asset"), u("deliverNow")]}>
          {lines.filter((l) => l.delivered > 0).map((l) => <tr key={l.key}><td>{l.poLineNo ?? l.source}</td><td>{l.description}</td><td className="font-mono">{l.assetCode ?? ""}</td><td>{l.delivered}</td></tr>)}
        </Table>
        {note.overrideReason && <p className="text-xs text-alert-ink">MD: {note.overrideReason}</p>}
      </Card>
      {signed ? <Card title={u("customerSignature")}><p className="text-sm">{note.signedBy} · {note.signedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(note.signedAt) : ""}{note.remark ? ` · ${note.remark}` : ""}</p></Card> : (
        <form id="f" action={sign}>
          <Card title={u("customerSignature")}>
            <Grid>
              <Field label={u("signedByName")} required><input name="signedBy" required className={inputCls} /></Field>
              <Field label={u("signedAt")} required><input name="signedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
              <Field label={u("remark")}><input name="remark" className={inputCls} /></Field>
            </Grid>
          </Card>
        </form>
      )}
    </StepPage>
  );
}
