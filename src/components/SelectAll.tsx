"use client";
/** Ticks or clears every checkbox named `name` in the same form (bulk review of fault codes). */
export function SelectAll({ name = "id", label }: { name?: string; label: string }) {
  return (
    <label className="inline-flex items-center gap-1 text-sm text-navy/80">
      <input type="checkbox" aria-label={label} onChange={(e) => { e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => { c.checked = e.currentTarget.checked; }); }} />
      {label}
    </label>
  );
}
