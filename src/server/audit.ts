/** Append-only audit trail for sensitive reads and changes. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function audit(actorId: string, action: string, target: string, detail?: Record<string, unknown>, tx: PrismaClient | Prisma.TransactionClient = prisma) {
  await tx.auditLog.create({ data: { actorId, action, target, detail: detail as Prisma.InputJsonValue | undefined } });
}
