import type { Prisma, PrismaClient } from "@prisma/client";
import { MONEY_PREFIXES, TEST_MARK, countryFromEmployeeCode, formatNumber, liveNumbers, periodKey, type CountryCode, type Prefix } from "./numbering";

/**
 * Allocate the next number atomically. Call inside the transaction that creates the record,
 * so a failed insert never burns a serial. Voided documents keep their number (set voidedAt), never delete.
 */
export async function allocateNumber(
  tx: PrismaClient | Prisma.TransactionClient,
  opts: { prefix: Prefix; createdByEmployeeCode: string; entityId: string; date?: Date; country?: CountryCode },
): Promise<string> {
  // probes on a developer's database can use up a day's two-digit serials; PROBE_DAYS_AHEAD lets them number from a later
  // day. Never read in production.
  const ahead = process.env.NODE_ENV !== "production" ? Number(process.env.PROBE_DAYS_AHEAD ?? 0) || 0 : 0;
  const date = new Date((opts.date ?? new Date()).getTime() + ahead * 86400000);
  // `country` is only for the first employees of a new entity (EVN created by an ETH MD); everything else follows the creator.
  if (opts.country && opts.prefix !== "E") throw new Error("country override is only allowed for employee numbers");
  const country = opts.country ?? countryFromEmployeeCode(opts.createdByEmployeeCode);
  const period = periodKey(opts.prefix, date);

  // The serial runs per country in the number, not per entity booked: a TH employee opening a customer for DCiV still
  // gets a CTH number, so it must come from the TH counter or it would collide with CTH numbers already issued.
  // One counter per country, kept on that country's legal entity (countryCode is unique and fixed once created).
  // Without an entity for the country there is no counter to use: borrowing another entity's would restart at 001
  // once the country's own entity exists and hand out numbers that were already issued (review 2026-11-07).
  const owner = (await tx.legalEntity.findUnique({ where: { countryCode: country }, select: { id: true } }))?.id;
  if (!owner) throw new Error(`NO_ENTITY_FOR_COUNTRY:${country}`);
  // TEST 号段: money documents before go-live count on their own row and carry TEST- in front
  const test = MONEY_PREFIXES.includes(opts.prefix) && !liveNumbers();
  const key = test ? `${TEST_MARK}${opts.prefix}` : opts.prefix;
  const seq = await tx.docSequence.upsert({
    where: { entityId_prefix_period: { entityId: owner, prefix: key, period } },
    create: { entityId: owner, prefix: key, period, last: 1 },
    update: { last: { increment: 1 } },
    select: { last: true },
  });

  // a master number already taken (records kept or imported while the counter was reset — 2026-11-19: the first new
  // employee after the cleanup got ETH2611001, the MD's number, and the save was refused) is skipped, never handed out twice
  const taken = TAKEN[opts.prefix as keyof typeof TAKEN];
  let last = seq.last;
  if (taken && !test) {
    while (await taken(tx, formatNumber(opts.prefix, country, date, last))) last++;
    if (last !== seq.last) await tx.docSequence.update({ where: { entityId_prefix_period: { entityId: owner, prefix: key, period } }, data: { last } });
  }
  return (test ? TEST_MARK : "") + formatNumber(opts.prefix, country, date, last);
}

type Tx = PrismaClient | Prisma.TransactionClient;
const TAKEN = {
  E: async (tx: Tx, code: string) => !!(await tx.employee.findUnique({ where: { code }, select: { id: true } })),
  C: async (tx: Tx, code: string) => !!(await tx.customer.findUnique({ where: { code }, select: { id: true } })),
  A: async (tx: Tx, code: string) => !!(await tx.asset.findUnique({ where: { code }, select: { id: true } })),
  S: async (tx: Tx, code: string) => !!(await tx.supplier.findUnique({ where: { code }, select: { id: true } })),
};
