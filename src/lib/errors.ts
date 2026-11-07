/**
 * Turn whatever a service threw into something a person can read: stable codes stay as they are (pages translate
 * `err_<CODE>`); validation and database errors become INVALID_INPUT / DUPLICATE / NOT_FOUND / SAVE_FAILED
 * instead of raw Zod JSON or Prisma invocation text.
 */
export function errorCode(e: unknown): string {
  const err = e as { name?: string; message?: string; issues?: { path: (string | number)[]; message: string }[]; code?: string; meta?: { target?: string[] | string; modelName?: string } };
  if (Array.isArray(err?.issues)) {
    // A schema may carry its own stable code as the message (regex(…, "ENTITY_CODE")): that says more than a field name.
    const coded = err.issues.find((i) => /^[A-Z][A-Z0-9_]+$/.test(i.message));
    if (coded) return coded.message;
    const fields = [...new Set(err.issues.map((i) => i.path.filter((p) => typeof p === "string").join(".") || i.message))];
    return `INVALID_INPUT:${fields.join(", ")}`;
  }
  if (typeof err?.code === "string" && /^P\d{4}$/.test(err.code)) {
    if (err.code === "P2002") return `DUPLICATE:${[err.meta?.target ?? []].flat().join(", ")}`;
    if (err.code === "P2025") return "NOT_FOUND";
    return "SAVE_FAILED";
  }
  const msg = err?.message ?? "error";
  if (/Invalid `prisma\.|PrismaClient/.test(msg)) return "SAVE_FAILED";
  return msg;
}
