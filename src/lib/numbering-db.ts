import type { Prisma, PrismaClient } from "@prisma/client";
import { countryFromEmployeeCode, formatNumber, periodKey, type CountryCode, type Prefix } from "./numbering";

/**
 * Allocate the next number atomically. Call inside the transaction that creates the record,
 * so a failed insert never burns a serial. Voided documents keep their number (set voidedAt), never delete.
 */
export async function allocateNumber(
  tx: PrismaClient | Prisma.TransactionClient,
  opts: { prefix: Prefix; createdByEmployeeCode: string; entityId: string; date?: Date; country?: CountryCode },
): Promise<string> {
  const date = opts.date ?? new Date();
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
  const seq = await tx.docSequence.upsert({
    where: { entityId_prefix_period: { entityId: owner, prefix: opts.prefix, period } },
    create: { entityId: owner, prefix: opts.prefix, period, last: 1 },
    update: { last: { increment: 1 } },
    select: { last: true },
  });

  return formatNumber(opts.prefix, country, date, seq.last);
}
