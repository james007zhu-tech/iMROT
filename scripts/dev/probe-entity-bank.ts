/** Probe: 法人收款银行 — save, clear, validation, and what invoices print (2026-11-09). Restores the TH entity afterwards. */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { saveLegalEntity } from "@/server/opd";
import { bankLines, type BankDetails } from "@/lib/bank";

let fails = 0;
const assert = (c: unknown, m: string) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails++; };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const th = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const base = { actorCode: md.code, countryCode: "TH", code: th.code, nameEn: th.nameEn, localCurrency: th.localCurrency, vatRate: Number(th.vatRate) };
  try {
    await saveLegalEntity({ ...base, bankDetails: { bank: "BANK OF CHINA (THAI) PCL", branch: "RAYONG BRANCH", bankCode: "052", branchCode: "0003", accountName: "DUCHENG INDUSTRIAL (THAILAND)CO., LTD.", swift: "bkchthbkxxx", accounts: { THB: "100000301445119", USD: "100000301445131", RMB: "100000301445120", EUR: "100000301445142", VND: "" } } });
    let e = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
    const b = e.bankDetails as BankDetails;
    assert(b.swift === "BKCHTHBKXXX" && b.accounts?.CNY === "100000301445120" && !("RMB" in (b.accounts ?? {})) && !("VND" in (b.accounts ?? {})), "saved: SWIFT upper-case, RMB stored as CNY, empty currency dropped");
    assert(bankLines(b, "CNY").includes("CNY 100000301445120") && bankLines(b, "CNY").includes("THB 100000301445119") && !bankLines(b, "CNY").includes("USD"), "CNY invoice prints CNY + THB accounts");
    await saveLegalEntity({ ...base, nameEn: th.nameEn });
    e = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
    assert((e.bankDetails as BankDetails)?.bank === "BANK OF CHINA (THAI) PCL", "a save without the bank block leaves the bank as it was");
    for (const [bd, code] of [[{ bank: "X", swift: "ABC" }, "BAD_SWIFT"], [{ bank: "X", accounts: { THB: "12/3" } }, "BAD_ACCOUNT"], [{ accounts: { THB: "123" } }, "BANK_ACCOUNT_NO_BANK"]] as const) {
      const err = await saveLegalEntity({ ...base, bankDetails: bd as BankDetails }).then(() => "", (x: Error) => x.message);
      assert(err.startsWith(code), `rejects ${code}`);
    }
    const viewer = await prisma.employee.findFirst({ where: { role: { not: "MD" }, active: true } });
    if (viewer) assert((await saveLegalEntity({ ...base, actorCode: viewer.code, bankDetails: {} }).then(() => "", (x: Error) => x.message)).length > 0, "only the MD may change the bank");
    await saveLegalEntity({ ...base, bankDetails: {} });
    e = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
    assert(e.bankDetails === null, "all fields empty clears the bank");
  } finally {
    await prisma.legalEntity.update({ where: { countryCode: "TH" }, data: { bankDetails: th.bankDetails ?? Prisma.JsonNull } });
  }
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
}
main();
