import { assertOrderAccess } from "@/server/scope";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { acceptEvidence, attachAcceptSheet, missingForAcceptance, recordAcceptance } from "@/server/slm-docs";
import { isTradeMode } from "@/lib/modes";
import { currentEmployee } from "@/server/auth";
import { mayAccept } from "@/server/scope";
import { guarded } from "@/lib/action-result";
import { maskName, staffContact } from "@/lib/mask";
import { saveUpload } from "@/lib/uploads";
import { shortDate, localIso } from "@/lib/dates";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, Field, Grid, inputCls } from "@/components/ui";
import { StepPage, atts, dayNow, loadOrder, str } from "../_shell";
import { issueNeeds } from "@/server/scm";

export const dynamic = "force-dynamic";
const ROWS = 8;

/** 验收 — wireframe 8: renders the service completion record and the customer acceptance form. */
export default async function Accept({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  // 备件：已出库 i/n (V4-P0-10) — the person signing sees whether the quoted parts really left the store
  const partsQuoted = order.lines.filter((l) => l.partId).length, partsLeft = (await issueNeeds(no))?.lines.length ?? 0;
  const [contacts, me, missing] = await Promise.all([prisma.contact.findMany({ where: { customerId: order.customerId }, orderBy: { name: "asc" } }), currentEmployee(), missingForAcceptance(no)]);
  const required = ["INTH", order.kind === "MAINTENANCE" || order.kind === "CONTRACT" ? "PMTH" : "RPTH", ...(order.repairJobs.some((j) => j.location === "WORKSHOP") ? ["ERTH", "DNTH"] : [])];
  // Deliverables default to the job's tests (what was proven), then parts and the parameter backup.
  const job = order.repairJobs.at(-1);
  const tests = ((job?.tests as { test: string; criterion?: string; result?: string }[] | null) ?? []).map((x) => ({ d: x.test, c: x.criterion ?? "", r: x.result ?? "" }));
  const parts = ((job?.partsReplaced as { partSku: string; newSerial?: string }[] | null) ?? []);
  const rows = [...tests, ...(parts.length ? [{ d: u("partsReplaced"), c: u("newSerialRecorded"), r: parts.map((p) => p.newSerial ?? p.partSku).join(" / ") }] : []), ...(job?.configBackupRef ? [{ d: u("paramBackup"), c: u("fileArchived"), r: job.configBackupRef }] : [])];
  const today = localIso(new Date())!.slice(0, 10);
  // 验收依据 (派修单 v5 P1-11)
  const trade = isTradeMode(order.mode), evidence = await acceptEvidence(order), canSign = await mayAccept(me, order.id);
  const siblings = trade || !canSign ? [] : await prisma.serviceOrder.findMany({ where: { customerId: order.customerId, id: { not: order.id }, status: "ACCEPTANCE_PENDING", mode: { notIn: ["DOMESTIC_TRADE", "INTERNATIONAL_TRADE"] } }, orderBy: { no: "asc" }, take: 30, select: { id: true, no: true, reportedSymptom: true, acceptSheet: true } });
  const also: typeof siblings = []; for (const o of siblings) if (!(o.acceptSheet as { files?: unknown[] } | null)?.files?.length && (await mayAccept(me, o.id))) also.push(o); // N-36: an order that already has its sheet is not offered
  async function sheet(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const files: { name: string; url: string }[] = [];
      for (const x of f.getAll("sheet")) if (x instanceof File && x.size > 0) files.push(await saveUpload(x, "accept"));
      await attachAcceptSheet({ orderNos: [no, ...f.getAll("also").map(String)], actorCode: me.code, files });
      return "acceptSheetSaved";
    }, `/service-orders/${no}/accept`);
  }
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee(); await assertOrderAccess(me, no);
      const deliverables = Array.from({ length: ROWS }, (_, i) => ({ deliverable: str(f, `d${i}`) ?? "", criterion: str(f, `c${i}`), result: str(f, `r${i}`) })).filter((x) => x.deliverable);
      const status = f.get("status") as "ACCEPTED" | "CONDITIONAL" | "REJECTED";
      if (status === "CONDITIONAL" && !str(f, "punchList")) throw new Error("CONDITIONAL_NEEDS_PUNCH");
      if (status !== "REJECTED" && !f.get("confirmLock")) throw new Error("ACCEPTANCE_CONFIRM_REQUIRED");
      const contactId = str(f, "contactId");
      const contact = contactId ? await prisma.contact.findUnique({ where: { id: contactId } }) : null;
      // The customer's signature: a photo taken here, else the signed form from the upload box, else what the portal already has.
      const photo = f.get("signaturePhoto");
      const signed = photo instanceof File && photo.size > 0 ? (await saveUpload(photo, "signature")).url : atts(f).find((a) => a.kind === "ACCEPTANCE")?.url ?? atts(f)[0]?.url;
      await recordAcceptance({ serviceOrderNo: no, actorCode: me.code, deliverables, status, punchList: str(f, "punchList"), acceptedAt: dayNow(str(f, "acceptedAt")), warrantyStart: str(f, "warrantyStart") ? new Date(str(f, "warrantyStart")!) : undefined, warrantyTerms: str(f, "warrantyTerms"), customerContactId: contactId, customerSignatory: str(f, "customerSignatory") ?? contact?.name, signatureUrl: signed, dcitSignatory: str(f, "dcitSignatory") ?? me.name, sheet: atts(f).map((a) => ({ name: (a as { name?: string }).name, url: a.url })) });
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/accept`);
  }
  return (
    <StepPage badge={partsQuoted ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${partsLeft ? "bg-alert/15 text-alert-ink" : "bg-blue/10 text-navy"}`}>{u("acceptParts", { done: partsQuoted - partsLeft, all: partsQuoted })}</span> : undefined} order={order} title={u("step_accept")} error={error} kind="acceptance" uploadTitle={u("upAcceptTitle")} uploadHint={u("upAcceptHint")} saveLabel={canSign && !missing.length && (evidence || !trade) ? u("saveAcceptance") : ""} notice={!canSign ? u("acceptReadOnly") : missing.length ? u("acceptMissingDocs", { docs: missing.join(", ") }) : !evidence ? u(trade ? "acceptNeedsDn" : "acceptTwoWays") : undefined}>
      <Card title={u("acceptEvidence")} accent={!evidence}>
        {evidence?.kind === "DN" && <p className="text-sm">✓ {u("acceptByDn")} <a href={evidence.href} className="font-mono text-blue underline">{evidence.no}</a> · {evidence.by ?? "—"} · {evidence.at ? localIso(evidence.at)!.slice(0, 10) : ""}</p>}
        {evidence?.kind === "PORTAL" && <p className="text-sm">✓ {u("acceptByPortal", { who: evidence.name, date: evidence.at.slice(0, 10) })}</p>}
        {evidence?.kind === "SHEET" && <p className="text-sm">✓ {u("acceptBySheet")} <a href={evidence.href} target="_blank" className="text-blue underline">{evidence.name}</a> · {evidence.by} · {evidence.at.slice(0, 10)}{evidence.orders.length > 1 ? ` · ${u("acceptSheetCovers", { list: evidence.orders.join("、") })}` : ""}</p>}
        {!evidence && trade && <p className="text-sm font-semibold text-[#C0392B]">{u("acceptNeedsDn")}</p>}
        {!evidence && !trade && <p className="text-sm font-semibold text-[#C0392B]">{u("acceptTwoWays")}</p>}
        {!trade && canSign && ["IN_PROGRESS", "ACCEPTANCE_PENDING", "ACCEPTED"].includes(order.status) && <form action={sheet} data-nodraft className="mt-2 space-y-2 text-sm">
          <input type="file" name="sheet" accept="application/pdf,image/*" multiple required className="block w-full text-sm" />
          {also.length > 0 && <fieldset className="rounded-lg border border-hair p-2"><legend className="px-1 text-xs text-navy/70">{u("acceptSheetAlso")}</legend>
            {also.map((o) => <label key={o.no} className="flex items-center gap-2 py-0.5"><input type="checkbox" name="also" value={o.no} /><span className="font-mono">{o.no}</span><span className="truncate text-xs text-navy/60">{o.reportedSymptom}</span></label>)}</fieldset>}
          <button className="min-h-10 whitespace-nowrap rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">{u(evidence ? "acceptSheetReplace" : "acceptSheetUpload")}</button>
        </form>}
      </Card>
      <form id="f" action={save} className="space-y-4">
        <Card title={u("acceptChecklist")}>
          <ul className="grid gap-1 text-sm md:grid-cols-2">
            {required.map((k) => <li key={k} className={missing.includes(k) ? "font-semibold text-alert-ink" : ""}>{missing.includes(k) ? "✗" : "✓"} {k} · {u(`doc_${k}`)}</li>)}
          </ul>
          {missing.length > 0 && <Alert>{u("acceptMissingDocs", { docs: missing.join(", ") })}</Alert>}
        </Card>
        <Card title={u("deliverables")}>
          <div className="hidden grid-cols-3 gap-2 text-xs text-navy/70 md:grid"><span>{u("deliverable")}</span><span>{t("criterion")}</span><span>{t("result")}</span></div>
          <RevealRows initial={Math.max(rows.length, 1)} addLabel={u("addDeliverable")}>
            {Array.from({ length: ROWS }, (_, i) => <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3"><input name={`d${i}`} defaultValue={rows[i]?.d ?? ""} className={inputCls} /><input name={`c${i}`} defaultValue={rows[i]?.c ?? ""} className={inputCls} /><input name={`r${i}`} defaultValue={rows[i]?.r ?? ""} className={inputCls} /></div>)}
          </RevealRows>
        </Card>
        <Card title={u("acceptanceResult")}>
          <Grid>
            <Field label={u("acceptStatus")} required><select name="status" className={inputCls}><option value="ACCEPTED">{t("accepted")}</option><option value="CONDITIONAL">{t("conditional")}</option><option value="REJECTED">{t("rejected")}</option></select></Field>
            <Field label={u("acceptDate")}><input name="acceptedAt" type="date" defaultValue={today} className={inputCls} /></Field>
            <Field label={u("warranty")}><div className="flex gap-2"><input name="warrantyStart" type="date" defaultValue={today} className={inputCls} /><input name="warrantyTerms" placeholder={u("warrantyTermsPh")} className={inputCls} /></div></Field>
            <Field label={u("punchListOwner")}><input name="punchList" className={inputCls} /></Field>
            <Field label={u("customerRep")} required><select name="contactId" defaultValue={contacts.length === 1 ? contacts[0].id : ""} className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{staffContact(c)}{c.title ? ` · ${c.title}` : ""}</option>)}</select></Field>
            <Field label={u("acceptSignature")}>
              <div className="flex flex-wrap items-center gap-2">
                {order.acceptance?.signatureUrl && <a href={order.acceptance.signatureUrl} target="_blank" className="rounded-full border border-navy/35 bg-tint px-2.5 py-1 text-xs font-semibold text-navy">✓ {u("signedOn", { date: shortDate(order.acceptance.acceptedAt) })}</a>}
                <input name="signaturePhoto" type="file" accept="image/*" capture="environment" className={inputCls} />
              </div>
            </Field>
            <Field label={u("dcitRep")}><input name="dcitSignatory" defaultValue={me.name} className={inputCls} /></Field>
          </Grid>
          <p className="text-xs text-navy/70">{u("acceptRuleNote")}</p>
          <div className="rounded-lg border border-alert bg-alert/10 p-3 text-sm">
            <b className="text-alert-ink">{u("acceptLockTitle")}</b>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>{u("acceptLock1")}</li><li>{u("acceptLock2")}</li><li>{u("acceptLock3")}</li><li>{u("acceptLock4")}</li>
            </ol>
            <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" name="confirmLock" value="1" /> {u("acceptConfirm")}</label>
          </div>
        </Card>
      </form>
    </StepPage>
  );
}
