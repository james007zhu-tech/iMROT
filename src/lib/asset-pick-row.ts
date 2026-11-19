/** One machine as the new-order picker shows it (src/components/AssetPicker.tsx). */
export type PickAsset = { code: string; serial: string; location: string; customerId: string; customer: string; plant: string; model: string; label: string };

export function pickRow(a: { code: string; serialNumber: string; location: string | null; customerId: string | null; customer: { name: string } | null; plant: { code: string; name: string } | null; model: { code: string } | null }) : PickAsset {
  return { code: a.code, serial: a.serialNumber, location: a.location ?? "", customerId: a.customerId ?? "", customer: a.customer?.name ?? "", plant: a.plant ? `${a.plant.code} ${a.plant.name}` : "", model: a.model?.code ?? "",
    label: `${a.code} · ${a.model?.code ?? ""} · ${a.location ?? ""} · ${a.customer?.name ?? ""}${a.plant ? ` ${a.plant.code}` : ""} · S/N ${a.serialNumber}` };
}
