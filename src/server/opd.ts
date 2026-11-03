/**
 * OPD · employees. Only the MD may see or change them (decision 2026-11-03); every change is audited.
 * The ETH/EVN/ECN number follows the legal entity chosen, so the MD can create the first staff of a new country.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { hashPassword } from "@/lib/password";
import type { CountryCode } from "@/lib/numbering";
import { audit } from "@/server/audit";

export const STAFF_ROLES = ["MD", "SALES", "ENGINEER", "WAREHOUSE", "FINANCE", "MANAGER"] as const;

export function assertMd(role: string) {
  if (role !== "MD") throw new Error("MD only");
}

export const EmployeeInput = z.object({
  actorCode: z.string(),
  entityCode: z.string(),
  name: z.string().min(1),
  nameLocal: z.string().optional(),
  role: z.enum(STAFF_ROLES),
  email: z.string().email(),
  phone: z.string().optional(),
  locale: z.enum(["th", "zh", "en"]).default("th"),
  password: z.string().min(6),
  joinedAt: z.coerce.date().optional(),
});

export async function createEmployee(input: z.input<typeof EmployeeInput>) {
  const d = EmployeeInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  assertMd(actor.role);
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { code: d.entityCode } });
  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "E", createdByEmployeeCode: actor.code, entityId: entity.id, country: entity.countryCode as CountryCode, date: d.joinedAt });
    const e = await tx.employee.create({ data: { code, entityId: entity.id, name: d.name, nameLocal: d.nameLocal, role: d.role, email: d.email, phone: d.phone, locale: d.locale, passwordHash: hashPassword(d.password) } });
    await audit(actor.id, "EMPLOYEE_CREATE", code, { role: d.role, entity: entity.code }, tx);
    return e;
  });
}

export async function updateEmployee(input: { actorCode: string; code: string; role?: (typeof STAFF_ROLES)[number]; active?: boolean; password?: string; phone?: string; locale?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  assertMd(actor.role);
  if (input.code === actor.code && input.role && input.role !== "MD") throw new Error("the MD cannot remove their own MD role");
  const e = await prisma.employee.update({ where: { code: input.code }, data: { role: input.role, active: input.active, phone: input.phone, locale: input.locale, passwordHash: input.password ? hashPassword(input.password) : undefined } });
  await audit(actor.id, "EMPLOYEE_UPDATE", input.code, { role: input.role, active: input.active, passwordReset: !!input.password });
  return e;
}
