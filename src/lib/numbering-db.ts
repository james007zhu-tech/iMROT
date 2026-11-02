import type { PrismaClient } from "@prisma/client";
import { countryFromEmployeeCode, formatNumber, periodKey, type Prefix } from "./numbering";

/**
 * Allocate the next number atomically. Call inside the transaction that creates the record,
 * so a failed insert never burns a serial. Voided documents keep their number (set voidedAt), never delete.
 */
export async function allocateNumber(
  tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  opts: { prefix: Prefix; createdByEmployeeCode: string; entityId: string; date?: Date },
): Promise<string> {
  const date = opts.date ?? new Date();
  const country = countryFromEmployeeCode(opts.createdByEmployeeCode);
  const period = periodKey(opts.prefix, date);

  const seq = await tx.docSequence.upsert({
    where: { entityId_prefix_period: { entityId: opts.entityId, prefix: opts.prefix, period } },
    create: { entityId: opts.entityId, prefix: opts.prefix, period, last: 1 },
    update: { last: { increment: 1 } },
    select: { last: true },
  });

  return formatNumber(opts.prefix, country, date, seq.last);
}
