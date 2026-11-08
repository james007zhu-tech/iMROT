/**
 * General preventive-maintenance checks by asset type, used when the model library has no maintenance standards
 * for the model yet. Each entry is a ui message "item｜criterion" (so it is translated like every other label).
 * Criteria are typical shop practice — the model's own standards, once entered, replace this list.
 */
const LISTS: Record<string, number> = { VFD: 8, MOTOR: 6, PANEL: 6, PLC: 5 };
export function genericChecklist(assetType: string): string[] {
  const type = assetType in LISTS ? assetType : "OTHER";
  const n = LISTS[type] ?? 4;
  return Array.from({ length: n }, (_, i) => `pmg_${type}_${i + 1}`);
}
