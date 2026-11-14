import { localIso } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { credentialAlerts, probationDue } from "@/server/opd";
import { maskLogin, maskPhone } from "@/lib/mask";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";
const day = (v: Date | null | undefined) => (v ? localIso(v)!.slice(0, 10) : "—");

/** OPD · employees — the MD sees the list; everyone else lands on their own file (decision 2026-11-08). */
export default async function People({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string }> }) {
  const { ok, error, all } = await searchParams;
  const me = await currentEmployee();
  if (me.role !== "MD") redirect(`/people/${me.code}`);
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  const employees = await prisma.employee.findMany({
    where: all ? {} : { active: true }, orderBy: { code: "asc" },
    include: { entity: true, credentials: { where: { expiresAt: { not: null } } }, reviews: { orderBy: { reviewedAt: "desc" }, take: 1 } },
  });
  const now = new Date();
  const status = (e: (typeof employees)[number]) => e.leftAt || !e.active ? <Tag hot>{t("empLeft")}</Tag> : e.probationEndsAt && !e.confirmedAt && e.probationEndsAt > now ? <Tag>{t("empProbation")}</Tag> : <Tag>{t("empActive")}</Tag>;
  return (
    <div className="space-y-4">
      <PageHeader title={t("employees")} badge={<><Tag>{employees.filter((e) => e.active).length}</Tag><Tag>{t("mdOnly")}</Tag></>} newHref="/people/new" newLabel={t("newEmployee")}
        actions={<><Link href="/people/overtime" className="text-sm text-blue hover:underline">{t("overtime")}</Link><Link href={all ? "/people" : "/people?all=1"} className="text-sm text-blue hover:underline">{all ? t("empShowActive") : t("empShowAll")}</Link></>} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[c("code"), c("name"), c("role"), t("legalEntity"), t("joinedAt"), t("empContactsShort"), t("empCredentialExpiry"), t("empLatestReview"), c("status")]}>
          {employees.map((e) => {
            const alerts = credentialAlerts(e.credentials, now);
            const due = probationDue(e, e.reviews, now);
            const rv = e.reviews[0];
            return (
              <tr key={e.id}>
                <td><Link href={`/people/${e.code}`} className="font-mono text-blue hover:underline">{e.code}</Link></td>
                <td>{e.name}{e.nameLocal ? <span className="block text-xs text-navy/70">{e.nameLocal}</span> : null}</td>
                <td>{r(e.role)}{e.position ? <span className="block text-xs text-navy/70">{e.position}</span> : null}</td>
                <td>{e.entity.code}</td>
                <td>{day(e.joinedAt)}</td>
                <td className="text-xs">
                  {e.phone && <span className="block">{maskPhone(e.phone)}</span>}
                  {e.lineId && <span className="block">LINE {maskLogin(e.lineId)}</span>}
                  {e.wechatId && <span className="block">WeChat {maskLogin(e.wechatId)}</span>}
                </td>
                <td className="text-xs">
                  {alerts.length ? alerts.slice(0, 2).map((a) => <span key={a.id} className="block"><Tag hot>{t(`cred_${a.kind}`)} {a.days! < 0 ? t("empExpired") : t("empExpiresInDays", { n: a.days! })}</Tag></span>) : e.credentials.length ? <span className="text-navy/60">{t("empCredentialsOk")}</span> : "—"}
                </td>
                <td className="text-xs">
                  {due && <span className="block"><Tag hot>{t("empProbationReviewDue")} {day(e.probationEndsAt)}</Tag></span>}
                  {rv ? <span className="block">{rv.period}{rv.score ? ` · ${Number(rv.score)}` : ""}{rv.grade ? ` · ${rv.grade}` : ""}</span> : !due ? "—" : null}
                </td>
                <td>{status(e)}</td>
              </tr>
            );
          })}
        </Table>
      </div>
      <p className="text-xs text-navy/60">{t("empListNote")}</p>
    </div>
  );
}
