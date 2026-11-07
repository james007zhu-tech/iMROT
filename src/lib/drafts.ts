/**
 * Which unfinished RPTH / PMTH "save draft" continues. Shared by the service and the form pages so both pick the same job.
 * Only while work is still open on the order (not after it went to acceptance), and only a draft started after the
 * last finished job of the same kind — so an abandoned draft from before a rework is never picked up again.
 */
type Job = { assetId: string; kind: string; startedAt: Date | null; finishedAt: Date | null };
const OPEN_STATUSES = new Set(["ASSIGNED", "DIAGNOSING", "IN_PROGRESS"]);

export function openJob<T extends Job>(jobs: T[], o: { maintenance: boolean; orderStatus: string; assetId?: string }): T | undefined {
  if (!OPEN_STATUSES.has(o.orderStatus)) return undefined;
  const same = jobs.filter((j) => (j.kind === "MAINTENANCE") === o.maintenance && (!o.assetId || j.assetId === o.assetId));
  const lastDone = Math.max(0, ...same.filter((j) => j.finishedAt).map((j) => j.finishedAt!.getTime()));
  return same
    .filter((j) => !j.finishedAt && (j.startedAt?.getTime() ?? 0) > lastDone)
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0];
}
