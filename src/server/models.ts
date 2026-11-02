/** ALM product knowledge: brand → series → model, with fault codes, maintenance standards and BOM. */
import { prisma } from "@/lib/db";

export async function listModelTree() {
  return prisma.brand.findMany({ orderBy: { name: "asc" }, include: { series: { orderBy: { code: "asc" }, include: { models: { orderBy: { code: "asc" }, include: { _count: { select: { assets: true } } } } } } } });
}

export async function getModel(id: string) {
  return prisma.model.findUnique({ where: { id }, include: { series: { include: { brand: true, faultCodes: { where: { modelId: null } }, maintenanceStandards: { where: { modelId: null } } } }, faultCodes: true, maintenanceStandards: true, bom: { include: { part: true } }, assets: { select: { code: true, serialNumber: true, status: true, customer: { select: { name: true } } }, orderBy: { code: "asc" } } } });
}

export async function upsertBrand(code: string, name: string) {
  return prisma.brand.upsert({ where: { code }, update: { name }, create: { code: code.toUpperCase(), name } });
}
export async function upsertSeries(brandCode: string, code: string, name: string, notes?: string) {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { code: brandCode } });
  return prisma.series.upsert({ where: { brandId_code: { brandId: brand.id, code } }, update: { name, notes }, create: { brandId: brand.id, code, name, notes } });
}
export async function upsertModel(seriesId: string, data: { code: string; ratedPowerKw?: number; ratedVoltageV?: number; ratedCurrentA?: number; overloadClass?: string; controlMode?: string; designLifeYears?: number }) {
  return prisma.model.upsert({ where: { seriesId_code: { seriesId, code: data.code } }, update: { ...data }, create: { seriesId, ...data } });
}
export async function addFaultCode(seriesId: string, modelId: string | undefined, code: string, title: string, meaning?: string, firstChecks?: string) {
  return prisma.faultCode.create({ data: { seriesId, modelId, code, title, meaning, firstChecks } });
}
export async function addMaintenanceStandard(seriesId: string, modelId: string | undefined, item: string, intervalMonths?: number, intervalHours?: number, criterion?: string) {
  return prisma.maintenanceStandard.create({ data: { seriesId, modelId, item, intervalMonths, intervalHours, criterion } });
}
export async function addBomLine(modelId: string, sku: string, name: string, vendorPartNo: string, qty: number, position?: string) {
  const model = await prisma.model.findUniqueOrThrow({ where: { id: modelId }, include: { series: true } });
  const part = await prisma.part.upsert({ where: { sku }, update: {}, create: { sku, vendorPartNo, name, brandId: model.series.brandId } });
  return prisma.modelPart.create({ data: { modelId, partId: part.id, qty, position } });
}
