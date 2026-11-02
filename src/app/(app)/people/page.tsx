import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { currentEmployee, hashPassword } from "@/server/auth";

export const dynamic = "force-dynamic";

/** OPD · employees. ETH is allocated from the creator's country — a TH admin can only create ETH staff. */
export default async function People() {
  const me = await currentEmployee();
  const employees = await prisma.employee.findMany({ orderBy: { code: "asc" }, include: { entity: true } });
  async function create(form: FormData) {
    "use server";
    const me = await currentEmployee();
    if (me.role !== "ADMIN" && me.role !== "MANAGER") throw new Error("not allowed");
    await prisma.$transaction(async (tx) => {
      const code = await allocateNumber(tx, { prefix: "E", createdByEmployeeCode: me.code, entityId: me.entityId });
      await tx.employee.create({ data: { code, entityId: me.entityId, name: String(form.get("name")), role: form.get("role") as "ENGINEER", email: String(form.get("email") || "") || undefined, phone: String(form.get("phone") || "") || undefined, locale: String(form.get("locale") || "th"), passwordHash: form.get("password") ? hashPassword(String(form.get("password"))) : undefined } });
    });
    redirect("/people");
  }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">OPD · Employees</h1>
      {(me.role === "ADMIN" || me.role === "MANAGER") && <form action={create} className="flex flex-wrap gap-2 rounded-lg border bg-white p-3">
        <input name="name" placeholder="Name" className={input} required /><select name="role" className={input}>{["ENGINEER", "SALES", "FINANCE", "WAREHOUSE", "MANAGER", "ADMIN"].map((r) => <option key={r}>{r}</option>)}</select><input name="email" type="email" placeholder="Email (login)" className={input} /><input name="phone" placeholder="Phone" className={input} /><select name="locale" className={input}><option value="th">ไทย</option><option value="zh">中文</option><option value="en">EN</option></select><input name="password" type="password" placeholder="Initial password" className={input} />
        <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">+ ETH</button>
      </form>}
      <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Active</th></tr></thead>
        <tbody>{employees.map((e) => <tr key={e.id} className="border-t"><td className="px-3 py-2 font-mono">{e.code}</td><td className="px-3 py-2">{e.name}</td><td className="px-3 py-2">{e.role}</td><td className="px-3 py-2">{e.email ?? ""}</td><td className="px-3 py-2">{e.entity.countryCode}</td><td className="px-3 py-2">{e.active ? "✓" : "—"}</td></tr>)}</tbody></table></div>
    </div>
  );
}
