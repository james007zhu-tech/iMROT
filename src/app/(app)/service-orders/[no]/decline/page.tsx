import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { declineQuote } from "@/server/decline";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { DECLINE_REASONS, declineBlocker } from "@/lib/decline";
import { Alert, Card, Field, Grid, Table, inputCls } from "@/components/ui";
import { StepPage, atts, dayNow, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

const INSPECTION = /inspect|diagnos|检测|ตรวจ/i;

/**
 * 客户拒绝报价 (朱总 2026-11-09, mockup docs/mockups/quote-decline-v0.1.html screen 1): the customer's reply (required),
 * why, the inspection fee per machine — charged by default, waived only with a reason — and whether the machine has
 * to go back on a delivery note (it does when an ERTH took it into our workshop).
 */
export default async function Decline({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const contacts = await prisma.contact.findMany({ where: { customerId: order.customerId }, orderBy: { name: "asc" } });
  const blocked = declineBlocker(order);
  // A quote that already carries an inspection line for the machine prefills its fee.
  const quoted = (code: string) => order.lines.filter((l) => l.assetCode === code && INSPECTION.test(`${l.description} ${l.descriptionLocal ?? ""}`)).reduce((s, l) => s + Number(l.amount), 0);
  const received = order.events.filter((e) => e.type === "RECEIVED_WORKSHOP");
  const today = new Date().toISOString().slice(0, 10);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const o = await loadOrder(no);
      await declineQuote({
        no, actorCode: me.code, reason: String(f.get("reason") ?? ""), note: str(f, "declineNote"), toldAt: dayNow(str(f, "toldAt")), contactId: str(f, "contactId"),
        waived: f.get("fee") === "waive", waivedReason: str(f, "waivedReason"),
        fees: o.assets.map((l) => ({ assetCode: l.asset.code, amount: Number(f.get(`fee_${l.asset.code}`) || 0) })),
        attachments: atts(f),
      });
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/decline`);
  }

  return (
    <StepPage order={order} title={u("step_decline")} error={error} kind={blocked ? undefined : "decline"} uploadTitle={u("upDeclineTitle")} uploadHint={u("upDeclineHint")} saveLabel={blocked ? "" : u("declineConfirm")}>
      {blocked ? <Alert>{u(`err_${blocked}`, { detail: no })}</Alert> : (
        <form id="f" action={save} className="space-y-4">
          <Card title={u("declineReason")}>
            <div className="flex flex-wrap gap-2">
              {DECLINE_REASONS.map((r) => (
                <label key={r} className="cursor-pointer rounded-full border border-navy/30 bg-white px-3 py-1.5 text-sm has-[:checked]:border-blue has-[:checked]:bg-tint has-[:checked]:font-semibold has-[:checked]:text-navy">
                  <input type="radio" name="reason" value={r} required defaultChecked={r === "PRICE"} className="sr-only" />{u(`declineReason_${r}`)}
                </label>
              ))}
            </div>
            <Grid>
              <Field label={u("declineToldAt")} required><input name="toldAt" type="date" required defaultValue={today} className={inputCls} /></Field>
              <Field label={u("declineContact")}><select name="contactId" defaultValue={order.reportedById ?? ""} className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)}{c.title ? ` · ${c.title}` : ""}</option>)}</select></Field>
              <Field label={t("note")}><input name="declineNote" placeholder={u("declineNotePh")} className={inputCls} /></Field>
            </Grid>
          </Card>

          <Card title={u("inspectionFee")}>
            <div className="group/fee space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="cursor-pointer rounded-lg border border-navy/30 bg-white p-3 text-sm has-[:checked]:border-blue has-[:checked]:ring-2 has-[:checked]:ring-blue/20">
                  <input type="radio" name="fee" value="charge" defaultChecked className="mr-2" /><b className="text-navy">{u("feeCharge")}</b>
                  <span className="mt-1 block text-xs text-navy/70">{u("feeChargeHint")}</span>
                </label>
                <label className="cursor-pointer rounded-lg border border-navy/30 bg-white p-3 text-sm has-[:checked]:border-blue has-[:checked]:ring-2 has-[:checked]:ring-blue/20">
                  <input type="radio" name="fee" value="waive" id="feeWaive" className="mr-2" /><b className="text-navy">{u("feeWaive")}</b>
                  <span className="mt-1 block text-xs text-navy/70">{u("feeWaiveHint")}</span>
                </label>
              </div>
              <div className="group-has-[#feeWaive:checked]/fee:hidden">
                <Table head={[t("asset"), u("model"), "S/N", `${u("inspectionFee")} ${order.currency} · ${u("exVat")}`]}>
                  {order.assets.map((l) => {
                    const a = l.asset;
                    const pre = quoted(a.code);
                    return (
                      <tr key={a.id}>
                        <td className="font-mono">{a.code}</td>
                        <td>{a.model ? `${a.model.series.brand.name} ${a.model.series.name} · ${a.model.code}` : a.type}</td>
                        <td className="font-mono">{a.serialNumber}</td>
                        <td><input name={`fee_${a.code}`} type="number" min="0" step="0.01" defaultValue={pre > 0 ? pre.toFixed(2) : ""} placeholder="1500.00" className={`${inputCls} text-right`} /></td>
                      </tr>
                    );
                  })}
                </Table>
                <p className="mt-1 text-xs text-navy/70">{u("feeVatNote")}</p>
              </div>
              <div className="hidden group-has-[#feeWaive:checked]/fee:block">
                <Field label={u("feeWaivedReason")} required><input name="waivedReason" placeholder={u("feeWaivedReasonPh")} className={inputCls} /></Field>
              </div>
            </div>
          </Card>

          <Card title={u("machineReturn")}>
            {received.length > 0 ? (
              <div className="space-y-1 rounded-lg bg-tint px-3 py-2 text-sm">
                {received.map((e) => {
                  const acc = ((e.payload as { accessoryList?: { item: string; qty: number }[] } | null)?.accessoryList) ?? [];
                  const code = order.assets.find((l) => l.assetId === e.assetId)?.asset.code ?? "";
                  return <p key={e.id}>{u("machineInShop", { code, doc: e.sourceDocNo ?? "", date: e.occurredAt.toISOString().slice(0, 10), n: acc.length })}{acc.length ? ` (${acc.map((x) => x.item).join("、")})` : ""}</p>;
                })}
                <p className="font-semibold text-navy">{u("returnNeeded")}</p>
              </div>
            ) : <p className="text-sm text-navy/80">{u("returnNotNeeded")}</p>}
          </Card>
        </form>
      )}
    </StepPage>
  );
}
