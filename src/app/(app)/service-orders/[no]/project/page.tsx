import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { completeMilestone, invoiceMilestone } from "@/server/project";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { saveUpload } from "@/lib/uploads";
import { NEEDS_RECORD, milestoneAmount, nextMilestone, type Phase, type ProjectInfo } from "@/lib/project";
import { Alert, Card, Field, Grid, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

/**
 * 项目执行 (自动化项目, flow 2026-11-09): the nine milestones in order. The next one is completed here — FAT and SAT with
 * their test record, DELIVERY once a DNTH is signed; SAT accepts and locks the order. Each paying milestone, once done,
 * gets its instalment invoice (TITH + IVTH). After SAT the deliverables can be registered as assets (ATH, decision open).
 */
export default async function Project({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  if (order.mode !== "AUTOMATION_PROJECT") notFound();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const ms = await prisma.projectMilestone.findMany({ where: { serviceOrderId: order.id }, orderBy: { seq: "asc" } });
  const people = new Map((await prisma.employee.findMany({ where: { id: { in: ms.map((m) => m.doneById).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  const shape = ms.map((m) => ({ seq: m.seq, phase: m.phase, payPct: m.payPct == null ? null : Number(m.payPct), doneAt: m.doneAt, taxInvoiceNo: m.taxInvoiceNo }));
  const next = nextMilestone(shape);
  const info = (order.project as unknown as ProjectInfo | null) ?? { name: order.no };
  const subtotal = Number(order.subtotal ?? 0);
  const signedDn = order.deliveries.filter((d) => d.status === "SIGNED").length;
  const satDone = ms.some((m) => m.phase === "SAT" && m.doneAt);

  async function done(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const files = [...atts(f)];
      for (const x of f.getAll("files")) if (x instanceof File && x.size > 0) files.push({ ...(await saveUpload(x, "milestone")), name: x.name, kind: String(f.get("phase") ?? "") });
      const r = await completeMilestone({ no, actorCode: me.code, seq: Number(f.get("seq")), doneAt: str(f, "doneAt"), note: str(f, "note"), attachments: files });
      return { ok: r.phase, to: `/service-orders/${no}/project` };
    }, `/service-orders/${no}/project`);
  }
  async function invoice(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const r = await invoiceMilestone({ no, actorCode: me.code, seq: Number(f.get("seq")) });
      return { ok: `${r.taxInvoiceNo} · ${r.invoiceNo}`, to: `/service-orders/${no}/project` };
    }, `/service-orders/${no}/project`);
  }

  const phase = (p: string) => u(`phase_${p as Phase}`);
  const needsRecord = next && (NEEDS_RECORD as readonly string[]).includes(next.phase);
  return (
    <StepPage order={order} title={u("step_project")} error={error} ok={ok} formId="m" kind={next ? "acceptance" : undefined} uploadTitle={u("upMilestoneTitle")} uploadHint={u("upMilestoneHint")} saveLabel=""
      badge={order.lockedAt ? <Tag>{u("projectAccepted")}</Tag> : next ? <Tag hot>{phase(next.phase)}</Tag> : undefined}>
      <Card title={info.name}>
        <Grid>
          <Field label={u("projectDue")}><span>{info.dueDate ?? "—"}</span></Field>
          <Field label={u("projectContract")}><span>{order.currency} {subtotal.toFixed(2)} {u("exVat")}</span></Field>
          <Field label={u("projectDeliverables")}><span className="whitespace-pre-line">{(info.deliverables ?? []).map((d) => `${d.qty} × ${d.name}`).join("\n") || "—"}</span></Field>
        </Grid>
      </Card>

      <Card title={u("projectMilestones")}>
        <Table head={["#", u("milestone"), u("plannedOn"), u("milestoneDone"), u("payPct"), t("amount"), u("instalmentInvoice")]}>
          {ms.map((m, i) => {
            const amount = m.payPct ? milestoneAmount(shape[i], shape, subtotal) : 0;
            const files = (m.attachments as { name: string; url: string }[] | null) ?? [];
            return (
              <tr key={m.id} className={next?.seq === m.seq ? "bg-tint" : ""}>
                <td>{m.seq}</td>
                <td className="font-semibold">{phase(m.phase)}</td>
                <td className="whitespace-nowrap">{m.plannedOn?.toISOString().slice(0, 10) ?? "—"}</td>
                <td>{m.doneAt ? <>✓ {m.doneAt.toISOString().slice(0, 10)}{m.doneById ? ` · ${people.get(m.doneById) ?? ""}` : ""}{m.note ? <span className="block text-xs text-navy/70">{m.note}</span> : null}{files.map((a) => <a key={a.url} href={a.url} target="_blank" className="mr-2 block text-xs text-blue hover:underline">📄 {a.name}</a>)}</> : "—"}</td>
                <td className="text-right">{m.payPct ? `${Math.round(Number(m.payPct) * 1000) / 10}%` : ""}</td>
                <td className="whitespace-nowrap text-right">{m.payPct ? amount.toFixed(2) : ""}</td>
                <td>{m.taxInvoiceNo ? <span className="space-x-2 text-xs"><a className="font-mono text-blue hover:underline" href={`/api/documents/${m.taxInvoiceNo}/render?format=pdf`}>{m.taxInvoiceNo}</a>{m.invoiceNo && <a className="font-mono text-blue hover:underline" href={`/api/documents/${m.invoiceNo}/render?format=pdf`}>{m.invoiceNo}</a>}</span>
                  : m.payPct && m.doneAt ? <form action={invoice}><input type="hidden" name="seq" value={m.seq} /><button className={btnBlue}>{u("issueInstalment")}</button></form> : m.payPct ? <span className="text-xs text-navy/60">{u("instalmentWaits")}</span> : null}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {next && <form id="m" action={done}>
        <input type="hidden" name="seq" value={next.seq} /><input type="hidden" name="phase" value={next.phase} />
        <Card title={u("completeMilestone", { name: phase(next.phase) })} accent>
          {next.phase === "DELIVERY" && signedDn === 0 && <Alert>{u("deliveryNeedsDn")} <Link href={`/service-orders/${no}/deliver`} className="underline">{u("step_deliver")}</Link></Alert>}
          {next.phase === "SAT" && <Alert>{u("satLocks")}</Alert>}
          <Grid>
            <Field label={u("milestoneDoneOn")} required><input name="doneAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} /></Field>
          </Grid>
          <Field label={u("milestoneNote")}><textarea name="note" rows={2} className={inputCls} /></Field>
          <Field label={needsRecord ? u("testRecordFiles") : u("milestoneFiles")} required={!!needsRecord}><input name="files" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
          <button className={btnPrimary}>{u("markDone", { name: phase(next.phase) })}</button>
        </Card>
      </form>}

      <Card title={u("projectAssets")}>
        <p className="mb-2 text-xs text-navy/70">{u("projectAssetsHint")}</p>
        {order.assets.length > 0 && <ul className="mb-2 space-y-1 text-sm">{order.assets.map((l) => <li key={l.assetId} className="flex flex-wrap items-baseline gap-2"><Link href={`/assets/${l.asset.code}`} className="font-mono font-semibold text-blue hover:underline">{l.asset.code}</Link><span className="font-mono text-xs">S/N {l.asset.serialNumber}</span><span className="text-xs text-navy/70">{l.asset.model ? `${l.asset.model.series.brand.name} ${l.asset.model.code}` : l.asset.type}</span></li>)}</ul>}
        <div className="flex flex-wrap gap-2">
          {(info.deliverables ?? []).map((d) => <Link key={d.name} href={`/assets/new?customerId=${order.customerId}&order=${order.no}`} className={btnGhost}>＋ {d.name}</Link>)}
          <Link href={`/assets/new?customerId=${order.customerId}&order=${order.no}`} className={btnGhost}>＋ {u("pickNewAsset")}</Link>
        </div>
      </Card>
    </StepPage>
  );
}
