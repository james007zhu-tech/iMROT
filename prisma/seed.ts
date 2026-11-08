/**
 * Seed: the Thai legal entity from docs/brand/company_master.json, the first admin employee (ETH),
 * and one brand/series/model so the asset page has something to show.
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import master from "../docs/brand/company_master.json";
import { hashPassword } from "../src/lib/password";
import { allocateNumber } from "../src/lib/numbering-db";

const prisma = new PrismaClient();

async function main() {
  const th = await prisma.legalEntity.upsert({
    where: { countryCode: "TH" },
    update: { code: "DCiT" },
    create: {
      countryCode: "TH",
      code: "DCiT",
      nameEn: master.name_en,
      nameLocal: master.name_th,
      brand: master.brand,
      taxId: master.tax_id,
      branchCode: master.branch_code,
      addressEn: master.address_en,
      addressLocal: master.address_th,
      phone: master.phone,
      email: master.email,
      website: master.website,
      signatoryName: master.signatory,
      localCurrency: "THB",
      bookCurrency: "CNY",
      vatRate: master.vat_rate,
      bankDetails: {
        bank: master.bank,
        branch: master.bank_branch,
        bankCode: master.bank_code,
        branchCode: master.bank_branch_code,
        accountName: master.account_name,
        swift: master.swift,
        accounts: master.accounts,
      },
    },
  });

  // First employee is created by hand: there is nobody yet whose code could derive the country.
  // Vietnam and China entities so "所属法人" offers DCiT / DCiV / DCiC (decision 2026-11-03).
  // Placeholders only: the MD completes name, tax ID and bank details under System → Legal entities; edits are never overwritten.
  for (const e of [{ countryCode: "VN", code: "DCiV", nameEn: "DCiV (Vietnam)", localCurrency: "VND", vatRate: 0.1 }, { countryCode: "CN", code: "DCiC", nameEn: "DCiC (China)", localCurrency: "CNY", vatRate: 0.13 }]) {
    await prisma.legalEntity.upsert({ where: { countryCode: e.countryCode }, update: {}, create: { ...e, brand: "DCiT", bookCurrency: "CNY" } });
  }
  await prisma.employee.upsert({
    where: { code: "ETH2611001" },
    update: { passwordHash: hashPassword(process.env.SEED_ADMIN_PASSWORD ?? "dcit2026"), role: "MD" },
    create: {
      passwordHash: hashPassword(process.env.SEED_ADMIN_PASSWORD ?? "dcit2026"),
      code: "ETH2611001",
      entityId: th.id,
      name: "Zhu Dongsheng",
      role: "MD",
      email: master.email,
      locale: "zh",
    },
  });
  await prisma.docSequence.upsert({
    where: { entityId_prefix_period: { entityId: th.id, prefix: "E", period: "2611" } },
    update: {},
    create: { entityId: th.id, prefix: "E", period: "2611", last: 1 },
  });

  const sie = await prisma.brand.upsert({ where: { code: "SIE" }, update: {}, create: { code: "SIE", name: "SIEMENS" } });
  const s120 = await prisma.series.upsert({
    where: { brandId_code: { brandId: sie.id, code: "S120" } },
    update: {},
    create: { brandId: sie.id, code: "S120", name: "SINAMICS S120" },
  });
  await prisma.model.upsert({
    where: { seriesId_code: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" } },
    update: {},
    create: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" },
  });

  // Suppliers created before STH numbering (2026-11-08) get their number here; new ones are numbered when created.
  const numberer = await prisma.employee.findFirst({ where: { role: { in: ["MD", "ADMIN"] } }, orderBy: { createdAt: "asc" } });
  if (numberer) for (const s of await prisma.supplier.findMany({ where: { code: null }, orderBy: { createdAt: "asc" } })) {
    await prisma.$transaction(async (tx) => tx.supplier.update({ where: { id: s.id }, data: { code: await allocateNumber(tx, { prefix: "S", createdByEmployeeCode: numberer.code, entityId: s.entityId ?? numberer.entityId, date: s.createdAt }) } }));
  }

  console.log("seeded: LegalEntity TH, ETH2611001 (password: SEED_ADMIN_PASSWORD or dcit2026), SIE / S120 / 6SL3120-2TE41-0AA1");
}

main().finally(() => prisma.$disconnect());
