/**
 * Minimal zod subset for the dev harness (no npm access here). The real app depends on zod; this shim implements
 * exactly the surface the service layer uses so the same code runs under plain Node.
 */
type Check = (v: unknown, path: string) => unknown;

class Schema<T = unknown> {
  check: Check;
  opts: { optional?: boolean; def?: unknown };
  constructor(check: Check, opts: { optional?: boolean; def?: unknown } = {}) { this.check = check; this.opts = opts; }
  optional(): Schema<T | undefined> { return new Schema(this.check, { ...this.opts, optional: true }); }
  default(def: unknown): Schema<T> { return new Schema(this.check, { ...this.opts, optional: true, def }); }
  min(n: number, msg?: string): Schema<T> { return new Schema((v, p) => { const x = this.check(v, p); if (typeof x === "string" ? x.length < n : Number(x) < n) throw new Error(msg ?? `${p}: min ${n}`); return x; }, this.opts); }
  max(n: number): Schema<T> { return new Schema((v, p) => { const x = this.check(v, p); if (Number(x) > n) throw new Error(`${p}: max ${n}`); return x; }, this.opts); }
  positive(): Schema<T> { return new Schema((v, p) => { const x = this.check(v, p); if (!(Number(x) > 0)) throw new Error(`${p}: must be positive`); return x; }, this.opts); }
  int(): Schema<T> { return new Schema((v, p) => { const x = this.check(v, p); if (!Number.isInteger(x)) throw new Error(`${p}: must be int`); return x; }, this.opts); }
  parse(v: unknown): T { return this.run(v, "$") as T; }
  run(v: unknown, p: string): unknown {
    if (v === undefined) { if (this.opts.optional) return this.opts.def; throw new Error(`${p}: required`); }
    return this.check(v, p);
  }
}

export const z = {
  string: () => new Schema<string>((v, p) => { if (typeof v !== "string") throw new Error(`${p}: expected string`); return v; }),
  number: () => new Schema<number>((v, p) => { if (typeof v !== "number" || Number.isNaN(v)) throw new Error(`${p}: expected number`); return v; }),
  boolean: () => new Schema<boolean>((v, p) => { if (typeof v !== "boolean") throw new Error(`${p}: expected boolean`); return v; }),
  unknown: () => new Schema<unknown>((v) => v),
  enum: <U extends string>(vals: readonly U[]) => new Schema<U>((v, p) => { if (!vals.includes(v as U)) throw new Error(`${p}: expected one of ${vals.join("|")}, got ${String(v)}`); return v as U; }),
  array: <U>(inner: Schema<U>) => new Schema<U[]>((v, p) => { if (!Array.isArray(v)) throw new Error(`${p}: expected array`); return v.map((x, i) => inner.run(x, `${p}[${i}]`)); }),
  record: (inner: Schema) => new Schema<Record<string, unknown>>((v, p) => { if (typeof v !== "object" || v === null) throw new Error(`${p}: expected object`); return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inner.run(x, `${p}.${k}`)])); }),
  object: <S extends Record<string, Schema>>(shape: S) => new Schema<{ [K in keyof S]: unknown }>((v, p) => {
    if (typeof v !== "object" || v === null) throw new Error(`${p}: expected object`);
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(shape)) { const r = s.run((v as Record<string, unknown>)[k], `${p}.${k}`); if (r !== undefined) out[k] = r; }
    return out;
  }),
  coerce: { date: () => new Schema<Date>((v, p) => { const d = v instanceof Date ? v : new Date(v as string); if (isNaN(d.getTime())) throw new Error(`${p}: bad date`); return d; }) },
};
export type infer<T> = T extends Schema<infer U> ? U : never;
export type input<T> = T extends Schema<infer U> ? Partial<U> : never;
