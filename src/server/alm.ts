/**
 * ALM service layer. Every write to an asset goes through here and ends in an AssetEvent —
 * the asset page is a view over the event stream, so no other code path may update Asset directly.
 */
import { z } from "zod";
import { assetBySerial } from "@/server/asset-first";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import type { AssetEventType, AssetStatus, Prisma } from "@prisma/client";
import { canTransitionAsset } from "@/lib/lifecycle";

export const OnboardAssetInput = z.object({
  createdByEmployeeCode: z.string(), // decides country of the ATH number
  type: z.enum(["VFD", "MOTOR", "PLC", "PANEL", "DRIVE_TRAIN", "SENSOR", "OTHER"]),
  serialNumber: z.string().optional(),
  /** nameplate missing or unreadable: DCiT issues an internal serial number, the machine gets a label, a manager or the MD confirms */
  noSerial: z.boolean().optional(),
  modelId: z.string().optional(),
  customerId: z.string(),
  plantId: z.string().optional(),
  location: z.string().optional(),
  responsibleEmployeeId: z.string().optional(),
  origin: z.enum(["NEW_INSTALL", "TAKEOVER"]).default("TAKEOVER"),
  customerAssetNo: z.string().optional(),
  nameplatePhoto: z.string().optional(),
  configuration: z.record(z.unknown()).optional(),
  operatingConditions: z.record(z.unknown()).optional(),
  installedAt: z.coerce.date().optional(),
  /** Initial status: a taken-over machine is usually already running (IN_SERVICE); a spare goes to SPARE. */
  initialStatus: z.enum(["ONBOARDED", "IN_SERVICE", "SPARE"]).optional(),
});
export type OnboardAssetInput = z.input<typeof OnboardAssetInput>;

/** 建档 / 接管: minimum six fields — code (allocated), serial, model, customer, location, responsible. */
export async function onboardAsset(input: z.input<typeof OnboardAssetInput>) {
  const data = OnboardAssetInput.parse(input);
  const creator = await prisma.employee.findUniqueOrThrow({ where: { code: data.createdByEmployeeCode } });

  // one ATH, one serial number (朱总 2026-11-11): a serial already on file is that machine — never a second ATH
  const serial = data.noSerial ? "" : (data.serialNumber ?? "").trim();
  if (!data.noSerial && !serial) throw new Error("SERIAL_REQUIRED");
  if (serial) { const twin = await assetBySerial(prisma, serial); if (twin) throw new Error(`ASSET_SERIAL_EXISTS:${twin.code}`); }

  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "A", createdByEmployeeCode: creator.code, entityId: creator.entityId });
    data.serialNumber = serial || `DCiT-${code}`;
    const asset = await tx.asset.create({
      data: {
        code,
        entityId: creator.entityId,
        type: data.type,
        serialNumber: data.serialNumber,
        serialSource: data.noSerial ? "INTERNAL" : "NAMEPLATE",
        modelId: data.modelId,
        customerId: data.customerId,
        plantId: data.plantId,
        location: data.location,
        responsibleId: data.responsibleEmployeeId ?? creator.id,
        origin: data.origin,
        customerAssetNo: data.customerAssetNo,
        nameplatePhoto: data.nameplatePhoto,
        configuration: data.configuration as Prisma.InputJsonValue | undefined,
        operatingConditions: data.operatingConditions as Prisma.InputJsonValue | undefined,
        installedAt: data.installedAt,
        status: data.initialStatus ?? (data.origin === "TAKEOVER" ? "IN_SERVICE" : "ONBOARDED"),
      },
    });
    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: "ONBOARDED",
        actorId: creator.id,
        summary: `${data.origin} · S/N ${data.serialNumber}${data.noSerial ? " (internal — nameplate missing)" : ""}`,
        payload: { origin: data.origin, customerId: data.customerId, plantId: data.plantId, location: data.location, initialStatus: data.initialStatus ?? (data.origin === "TAKEOVER" ? "IN_SERVICE" : "ONBOARDED") },
      },
    });
    return asset;
  });
}

export const AppendEventInput = z.object({
  assetCode: z.string(),
  type: z.string(),
  actorEmployeeCode: z.string().optional(),
  actorName: z.string().optional(),
  serviceOrderNo: z.string().optional(),
  sourceDocNo: z.string().optional(),
  summary: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  occurredAt: z.coerce.date().optional(),
  /** optional status transition carried by the event (validated against the lifecycle below) */
  newStatus: z.string().optional(),
});

export async function appendAssetEvent(input: z.input<typeof AppendEventInput>) {
  const data = AppendEventInput.parse(input);
  const asset = await prisma.asset.findUniqueOrThrow({ where: { code: data.assetCode } });
  const actor = data.actorEmployeeCode ? await prisma.employee.findUniqueOrThrow({ where: { code: data.actorEmployeeCode } }) : null;
  const order = data.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: data.serviceOrderNo } }) : null;

  return prisma.$transaction(async (tx) => {
    if (data.newStatus) {
      const to = data.newStatus as AssetStatus;
      if (!canTransitionAsset(asset.status, to)) {
        throw new Error(`Asset ${asset.code}: ${asset.status} → ${to} is not allowed (only ACCEPTANCE leads back to IN_SERVICE)`);
      }
      await tx.asset.update({ where: { id: asset.id }, data: { status: to } });
    }
    return tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: data.type as AssetEventType,
        actorId: actor?.id,
        actorName: data.actorName,
        serviceOrderId: order?.id,
        sourceDocNo: data.sourceDocNo,
        summary: data.summary,
        payload: { ...(data.payload ?? {}), ...(data.newStatus ? { statusFrom: asset.status, statusTo: data.newStatus } : {}) } as Prisma.InputJsonValue,
        attachments: data.attachments as Prisma.InputJsonValue | undefined,
        occurredAt: data.occurredAt,
      },
    });
  });
}

/** Transfer between customers / plants / locations — ATH and serial never change. */
export async function transferAsset(opts: { assetCode: string; actorEmployeeCode: string; customerId?: string; plantId?: string; location?: string; note?: string }) {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { code: opts.assetCode } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: opts.actorEmployeeCode } });
  return prisma.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id: asset.id },
      data: { customerId: opts.customerId ?? asset.customerId, plantId: opts.plantId ?? asset.plantId, location: opts.location ?? asset.location },
    });
    return tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: "TRANSFERRED",
        actorId: actor.id,
        summary: opts.note ?? "",
        payload: {
          from: { customerId: asset.customerId, plantId: asset.plantId, location: asset.location },
          to: { customerId: opts.customerId ?? asset.customerId, plantId: opts.plantId ?? asset.plantId, location: opts.location ?? asset.location },
        },
      },
    });
  });
}

/** The asset page: header + full timeline + linked orders + relations + model knowledge. */
export async function getAssetPage(code: string) {
  return prisma.asset.findUnique({
    where: { code },
    include: {
      model: { include: { series: { include: { brand: true, faultCodes: { where: { modelId: null } }, maintenanceStandards: { where: { modelId: null } } } }, faultCodes: true, maintenanceStandards: true, bom: { include: { part: true } } } },
      customer: true,
      plant: true,
      responsible: { select: { code: true, name: true } },
      events: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { code: true, name: true } } } },
      relationsFrom: { where: { validTo: null }, include: { toAsset: { select: { code: true, type: true, serialNumber: true } } } },
      relationsTo: { where: { validTo: null }, include: { fromAsset: { select: { code: true, type: true, serialNumber: true } } } },
      orderLinks: { include: { serviceOrder: { select: { no: true, status: true, kind: true, reportedAt: true, total: true, currency: true } } } },
      parameterBackups: { orderBy: { takenAt: "desc" } },
    },
  });
}

/** Link two assets (VFD → motor, VFD → panel, …) and record it on the first asset's timeline. */
export async function relateAssets(opts: { fromCode: string; toCode: string; relation: "DRIVES" | "INSTALLED_IN" | "CONTROLLED_BY" | "COUPLED_TO"; actorEmployeeCode: string }) {
  const [a, b] = await Promise.all([prisma.asset.findUniqueOrThrow({ where: { code: opts.fromCode } }), prisma.asset.findUniqueOrThrow({ where: { code: opts.toCode } })]);
  if (a.id === b.id) throw new Error("an asset cannot be related to itself");
  await prisma.assetRelation.create({ data: { fromAssetId: a.id, toAssetId: b.id, relation: opts.relation } });
  return appendAssetEvent({ assetCode: a.code, type: "RELATION_CHANGED", actorEmployeeCode: opts.actorEmployeeCode, summary: `${a.code} ${opts.relation} ${b.code}`, payload: { relation: opts.relation, to: b.code } });
}

/** Model code as typed or read from a nameplate → model row (case-insensitive, exact). */
export async function findModelByCode(code: string) {
  return prisma.model.findFirst({ where: { code: { equals: code.trim(), mode: "insensitive" } }, include: { series: { include: { brand: true } } } });
}

const CATEGORY_OF: Record<string, string> = { VFD: "VFD", MOTOR: "MOTOR", PLC: "PLC" };
const codeFrom = (name: string, len: number) => name.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, len) || "X";

/**
 * The model of a machine being filed, created on the spot when the library does not have it (trial finding 2026-11-14:
 * a new model needed three library forms and the nameplate uploaded again). Brand and series are matched by name or
 * code, whatever the case; what is missing is created from what the nameplate form already says. The fault codes and
 * maintenance standards of the series are filled in later in the library — the machine does not wait for them.
 */
export async function ensureModel(input: { brand: string; series: string; modelCode: string; assetType?: string; ratedPowerKw?: number; ratedVoltageV?: number; ratedCurrentA?: number; actorId?: string }) {
  const code = input.modelCode.trim();
  const known = await findModelByCode(code);
  if (known) return { model: known, created: false };
  const brandName = input.brand.trim(), seriesName = input.series.trim();
  if (!brandName || !seriesName) throw new Error(`MODEL_NEEDS_BRAND_SERIES:${code}`);
  const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
  let brand = await prisma.brand.findFirst({ where: { OR: [{ name: ci(brandName) }, { code: ci(brandName) }] } });
  if (!brand) {
    let bc = codeFrom(brandName, 3);
    for (let i = 2; await prisma.brand.findUnique({ where: { code: bc } }); i++) bc = `${codeFrom(brandName, 3)}${i}`;
    brand = await prisma.brand.create({ data: { code: bc, name: brandName.toUpperCase() } });
  }
  let series = await prisma.series.findFirst({ where: { brandId: brand.id, OR: [{ name: ci(seriesName) }, { code: ci(seriesName) }, { aliases: { has: seriesName } }] } });
  if (!series) {
    let sc = codeFrom(seriesName.replace(new RegExp(`^${brand.name}\\s*`, "i"), ""), 12);
    for (let i = 2; await prisma.series.findFirst({ where: { brandId: brand.id, code: sc } }); i++) sc = `${sc.replace(/\d+$/, "")}${i}`;
    const cat = input.assetType && CATEGORY_OF[input.assetType] ? await prisma.productCategory.findUnique({ where: { code: CATEGORY_OF[input.assetType] } }) : null;
    series = await prisma.series.create({ data: { brandId: brand.id, code: sc, name: seriesName, categoryCode: cat?.code, publicVisible: false } });
  }
  const model = await prisma.model.create({
    data: { seriesId: series.id, code, ratedPowerKw: input.ratedPowerKw, ratedVoltageV: input.ratedVoltageV ? Math.round(input.ratedVoltageV) : undefined, ratedCurrentA: input.ratedCurrentA, specs: { createdWhileFiling: true } },
    include: { series: { include: { brand: true } } },
  });
  if (input.actorId) await prisma.auditLog.create({ data: { actorId: input.actorId, action: "MODEL_CREATED_INLINE", target: code, detail: { brand: brand.name, series: series.name } } });
  return { model, created: true };
}
