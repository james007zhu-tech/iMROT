/** 培训记录: who was trained in what, with what result. Managers and the MD record; everyone sees their own. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";

export const TRAINING_RESULTS = ["PLANNED", "ATTENDED", "PASSED", "FAILED"] as const;
export const LEVELS = ["L1", "L2", "L3", "L4"] as const; /// iMROT-T levels; certified by an engineer-led practical exam
const RECORDERS = ["MD", "ADMIN", "MANAGER"];

export const TrainingInput = z.object({
  actorCode: z.string(), employeeCodes: z.array(z.string()).min(1),
  title: z.string().min(1), kind: z.string().min(1), provider: z.string().optional(),
  startedOn: z.coerce.date(), endedOn: z.coerce.date().optional(), hours: z.coerce.number().min(0).max(999).optional(),
  result: z.enum(TRAINING_RESULTS).default("ATTENDED"), level: z.enum(LEVELS).optional(), score: z.coerce.number().min(0).max(100).optional(),
  certificateNo: z.string().optional(), expiresAt: z.coerce.date().optional(), note: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
});

/** One session, several people: a record each. A person may record their own (an online course they finished). */
export async function recordTraining(input: z.input<typeof TrainingInput>) {
  const d = TrainingInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const others = d.employeeCodes.filter((c) => c !== actor.code);
  if (others.length && !RECORDERS.includes(actor.role)) throw new Error("TRAINING_OWN_ONLY");
  if (d.endedOn && d.endedOn < d.startedOn) throw new Error("TRAINING_END_BEFORE_START");
  const people = await prisma.employee.findMany({ where: { code: { in: d.employeeCodes } } });
  if (people.length !== new Set(d.employeeCodes).size) throw new Error("TRAINING_UNKNOWN_EMPLOYEE");
  await prisma.trainingRecord.createMany({ data: people.map((p) => ({
    entityId: p.entityId, employeeId: p.id, title: d.title, kind: d.kind, provider: d.provider, startedOn: d.startedOn, endedOn: d.endedOn, hours: d.hours,
    result: d.result, level: d.level, score: d.score, certificateNo: d.certificateNo, expiresAt: d.expiresAt, note: d.note, attachments: d.attachments as Prisma.InputJsonValue, createdById: actor.id,
  })) });
  await audit(actor.id, "TRAINING_RECORD", d.title, { people: people.map((p) => p.code) });
  return people.length;
}

export async function removeTraining(input: { id: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const r = await prisma.trainingRecord.findUniqueOrThrow({ where: { id: input.id } });
  if (r.createdById !== actor.id && actor.role !== "MD") throw new Error("TRAINING_NOT_YOURS");
  await prisma.trainingRecord.delete({ where: { id: r.id } });
  await audit(actor.id, "TRAINING_REMOVE", r.title, { employeeId: r.employeeId });
}

export async function trainingFor(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const all = RECORDERS.includes(a.role);
  const [rows, staff] = await Promise.all([
    prisma.trainingRecord.findMany({ where: all ? { entityId: a.entityId } : { employeeId: a.id }, include: { employee: { select: { code: true, name: true, position: true } } }, orderBy: [{ startedOn: "desc" }, { createdAt: "desc" }], take: 300 }),
    all ? prisma.employee.findMany({ where: { entityId: a.entityId, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, position: true } }) : Promise.resolve([{ id: a.id, code: a.code, name: a.name, position: a.position }]),
  ]);
  return { me: a, all, rows, staff };
}
