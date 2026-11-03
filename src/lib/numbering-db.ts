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

  const seq = await tx.docSequence.upsert({
    where: { entityId_prefix_period: { entityId: opts.entityId, prefix: opts.prefix, period } },
    create: { entityId: opts.entityId, prefix: opts.prefix, period, last: 1 },
    update: { last: { increment: 1 } },
    select: { last: true },
  });

  return formatNumber(opts.prefix, country, date, seq.last);
}
