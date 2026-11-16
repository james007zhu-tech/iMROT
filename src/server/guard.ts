/** Role checks for server actions (需求清单 v3: 权限必须服务端强制). One error for all: NO_PERMISSION → 「无权限」. */
import { prisma } from "@/lib/db";

export async function actorWith(code: string, ok: (role: string) => boolean, err = "NO_PERMISSION") {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code } });
  if (!ok(a.role)) throw new Error(err);
  return a;
}
export function need(role: string, ok: (role: string) => boolean, err = "NO_PERMISSION") {
  if (!ok(role)) throw new Error(err);
}
