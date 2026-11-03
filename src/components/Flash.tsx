/** Banner for ?ok= / ?error= after a server action. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return error
    ? <div className="rounded-lg border border-alert bg-alert/10 px-4 py-2 text-sm text-alert-ink">⚠ {error}</div>
    : <div className="rounded-lg border border-blue bg-blue/8 px-4 py-2 text-sm text-navy">✓ {ok}</div>;
}
