/**
 * Margin floors per business mode (ModeRule). The MD sets them on /admin; until a row exists the decided default applies.
 */
import { prisma } from "@/lib/db";
import { DEFAULT_MARGIN_FLOOR, MODES, marginFloorFor, type Mode } from "@/lib/modes";

type Db = Pick<typeof prisma, "modeRule">;

export async function modeRules(db: Db = prisma): Promise<Record<Mode, number>> {
  const rows = await db.modeRule.findMany();
  const set = Object.fromEntries(rows.map((r) => [r.mode, Number(r.minMarginPct)])) as Partial<Record<Mode, number>>;
  return Object.fromEntries(MODES.map((m) => [m, set[m] ?? DEFAULT_MARGIN_FLOOR[m]])) as Record<Mode, number>;
}

export async function marginFloor(mode: string, db: Db = prisma): Promise<number> {
  return marginFloorFor(mode, await modeRules(db));
}

/** MD only. pct is a fraction (0.2 = 20 %). */
export async function setModeRules(input: { actorCode: string; floors: Partial<Record<Mode, number>> }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (actor.role !== "MD") throw new Error("FORBIDDEN");
  for (const [mode, pct] of Object.entries(input.floors) as [Mode, number][]) {
    if (!MODES.includes(mode) || !Number.isFinite(pct) || pct < 0 || pct >= 1) throw new Error(`INVALID_INPUT:${mode}`);
    await prisma.modeRule.upsert({ where: { mode }, create: { mode, minMarginPct: pct, updatedBy: actor.code }, update: { minMarginPct: pct, updatedBy: actor.code } });
  }
}
