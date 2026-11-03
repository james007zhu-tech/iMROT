import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { Flash } from "@/components/Flash";
import { Forbidden } from "@/components/Forbidden";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** OPD · employees — MD only. */
export default async function People({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const me = await currentEmployee();
  if (me.role !== "MD") return <Forbidden />;
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  const employees = await prisma.employee.findMany({ orderBy: { code: "asc" }, include: { entity: true } });
  return (
    <div className="space-y-4">
      <PageHeader title={t("employees")} badge={<Tag>{employees.filter((e) => e.active).length}</Tag>} newHref="/people/new" newLabel={t("newEmployee")} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[c("code"), c("name"), c("role"), t("legalEntity"), c("email"), c("phone"), c("active")]}>
          {employees.map((e) => (
            <tr key={e.id}>
              <td><Link href={`/people/${e.code}`} className="font-mono text-blue hover:underline">{e.code}</Link></td>
              <td>{e.name}{e.nameLocal ? <span className="block text-xs text-navy/70">{e.nameLocal}</span> : null}</td>
              <td>{r(e.role)}</td><td>{e.entity.code}</td><td>{e.email ?? ""}</td><td>{e.phone ?? ""}</td>
              <td>{e.active ? "✓" : <Tag hot>{t("inactive")}</Tag>}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
