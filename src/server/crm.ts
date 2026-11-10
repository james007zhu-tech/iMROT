/**
 * CRM service: customers (CTH), plants, contacts, and the masked-by-default contact view.
 * New customers are created only from DBD / ภ.พ.20 / billing documents (files kept on the customer);
 * DBD data is stored with the record and fields a person changed afterwards are listed in `editedFields`.
 */
import { z } from "zod";
import { cleanBirthday } from "@/lib/notify";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { audit } from "@/server/audit";
import { isClosedStatus } from "@/server/dbd";

const Plant = z.object({ code: z.string().min(1), name: z.string().min(1), address: z.string().optional(), accessNotes: z.string().optional() });
const Contact = z.object({ name: z.string().min(1), title: z.string().optional(), plantCode: z.string().optional(), phone: z.string().optional(), lineId: z.string().optional(), email: z.string().optional(), portalLogin: z.string().optional(), portalPassword: z.string().optional(), birthday: z.string().optional() });
const File = z.object({ name: z.string(), url: z.string(), kind: z.string() });

export const CustomerInput = z.object({
  actorCode: z.string(),
  entityCode: z.string(),
  /** 海外客户 (国际贸易, 2026-11-10): no Thai tax ID or DBD record — the registration number is free text and optional. */
  overseas: z.boolean().default(false),
  taxId: z.string().default(""),
  branchCode: z.string().regex(/^\d{5}$/).default("00000"),
  nameLocal: z.string().default(""),
  name: z.string().min(1),
  shortName: z.string().optional(),
  phone: z.string().optional(),
  addressLocal: z.string().optional(),
  addressEn: z.string().optional(),
  billingAddress: z.string().optional(),
  registeredCapital: z.number().optional(),
  foundedAt: z.coerce.date().optional(),
  defaultCurrency: z.string().default("THB"),
  paymentTermDays: z.number().int().min(0).default(30),
  monthlyStatement: z.boolean().default(false),
  source: z.string().optional(),
  dbd: z.object({ status: z.string().optional(), fetchedAt: z.coerce.date(), data: z.unknown(), values: z.record(z.string()) }).optional(),
  files: z.array(File).default([]),
  plants: z.array(Plant).min(1, "at least one plant"),
  contacts: z.array(Contact).default([]),
}).superRefine((d, ctx) => {
  if (!d.overseas && !/^\d{13}$/.test(d.taxId)) ctx.addIssue({ code: "custom", path: ["taxId"], message: "tax ID must be 13 digits" });
  if (!d.overseas && !d.nameLocal.trim()) ctx.addIssue({ code: "custom", path: ["nameLocal"], message: "required" });
});

export async function createCustomer(input: z.input<typeof CustomerInput>) {
  const d = CustomerInput.parse(input);
  if (isClosedStatus(d.dbd?.status)) throw new Error(`DBD_CLOSED:${d.dbd?.status}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { code: d.entityCode } });
  const dupe = d.taxId ? await prisma.customer.findFirst({ where: { taxId: d.taxId, branchCode: d.branchCode } }) : await prisma.customer.findFirst({ where: { name: { equals: d.name, mode: "insensitive" } } });
  if (dupe) throw new Error(`CUSTOMER_EXISTS:${dupe.code}:${dupe.name}`);
  // Which DBD-derived fields did a person change before saving?
  const edited = d.dbd ? Object.entries(d.dbd.values).filter(([k, v]) => (d as Record<string, unknown>)[k] !== undefined && String((d as Record<string, unknown>)[k]) !== v).map(([k]) => k) : [];
  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: actor.code, entityId: entity.id });
    const c = await tx.customer.create({
      data: {
        code, entityId: entity.id, name: d.name, nameLocal: d.nameLocal || (d.overseas ? null : d.name), taxId: d.taxId || null, branchCode: d.overseas ? null : d.branchCode, phone: d.phone,
        addressLocal: d.addressLocal, addressEn: d.addressEn, billingAddress: d.billingAddress, registeredCapital: d.registeredCapital, foundedAt: d.foundedAt,
        defaultCurrency: d.defaultCurrency, paymentTermDays: d.paymentTermDays, monthlyStatement: d.monthlyStatement,
        notes: [d.overseas ? "overseas customer" : "", d.shortName ? `short: ${d.shortName}` : "", d.source ? `source: ${d.source}` : ""].filter(Boolean).join("\n") || undefined,
        dbdStatus: d.dbd?.status, dbdFetchedAt: d.dbd?.fetchedAt, dbdData: d.dbd?.data as Prisma.InputJsonValue | undefined, editedFields: edited.length ? edited : undefined,
        files: d.files as Prisma.InputJsonValue,
      },
    });
    const plants = new Map<string, string>();
    for (const p of d.plants) plants.set(p.code, (await tx.plant.create({ data: { customerId: c.id, code: p.code, name: p.name, address: p.address, accessNotes: p.accessNotes } })).id);
    for (const k of d.contacts) {
      await tx.contact.create({ data: { customerId: c.id, plantId: k.plantCode ? plants.get(k.plantCode) : undefined, name: k.name, title: k.title, phone: k.phone, lineId: k.lineId, email: k.email, portalLogin: k.portalLogin || undefined, portalPasswordHash: k.portalLogin && k.portalPassword ? hashPassword(k.portalPassword) : undefined } });
    }
    await audit(actor.id, "CUSTOMER_CREATE", code, { taxId: d.taxId, dbd: !!d.dbd, edited }, tx);
    return c;
  });
}

export async function addPlant(customerCode: string, p: z.input<typeof Plant>) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode } });
  return prisma.plant.create({ data: { customerId: c.id, ...Plant.parse(p) } });
}

export async function addContact(customerCode: string, k: z.input<typeof Contact>) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode }, include: { plants: true } });
  const d = Contact.parse(k);
  return prisma.contact.create({ data: { customerId: c.id, plantId: c.plants.find((p) => p.code === d.plantCode)?.id, name: d.name, title: d.title, phone: d.phone, lineId: d.lineId, email: d.email, birthday: cleanBirthday(d.birthday), portalLogin: d.portalLogin || undefined, portalPasswordHash: d.portalLogin && d.portalPassword ? hashPassword(d.portalPassword) : undefined } });
}

/** Reset a portal contact's password (used by the trial-account script; audited). */
export async function setPortalPassword(actorCode: string, portalLogin: string, password: string) {
  if (password.length < 6) throw new Error("password must be at least 6 characters");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const c = await prisma.contact.update({ where: { portalLogin }, data: { portalPasswordHash: hashPassword(password) }, include: { customer: true } });
  await audit(actor.id, "PORTAL_PASSWORD_RESET", c.customer.code, { portalLogin });
  return c;
}

/** Re-enter the password to see a customer's contacts in full; every reveal is audited. */
export async function authorizeReveal(actorCode: string, password: string, customerCode: string) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!verifyPassword(password, actor.passwordHash)) throw new Error("WRONG_PASSWORD");
  await audit(actor.id, "CONTACT_REVEAL", customerCode, {});
}
