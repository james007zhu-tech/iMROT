/**
 * In-memory stand-in for PrismaClient, driven by prisma/schema.prisma.
 * Purpose: run the service layer and the smoke test with plain Node (no database, no generated client),
 * so the business logic can be exercised anywhere. Supports the subset the service layer uses:
 *   findUnique/findUniqueOrThrow/findFirst/findFirstOrThrow/findMany/create/createMany/update/upsert/deleteMany/groupBy
 *   where: equality, in, contains(+mode), lt/lte/gt/gte/not/equals, OR/AND, compound uniques (a_b_c), to-one relation filters, some
 *   include/select (recursive, _count), orderBy, take/skip, nested create/connect on lists, { increment }
 * Not a database: no constraints beyond unique checks on @unique/@@unique, no cascading.
 */
import { readFileSync } from "node:fs";

interface Field { name: string; type: string; list: boolean; optional: boolean; relFields?: string[]; relRefs?: string[]; relName?: string; isRelation: boolean; isId: boolean; unique: boolean; hasDefaultNow: boolean; updatedAt: boolean; defaultValue?: unknown }
interface Model { name: string; fields: Field[]; uniques: string[][]; idField: string }

const SCALARS = new Set(["String", "Int", "Float", "Decimal", "Boolean", "DateTime", "Json", "BigInt", "Bytes"]);

export function parseSchema(src: string): { models: Map<string, Model>; enums: Map<string, string[]> } {
  const models = new Map<string, Model>();
  const enums = new Map<string, string[]>();
  const enumRe = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = enumRe.exec(src))) enums.set(m[1], m[2].split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter(Boolean));
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  while ((m = modelRe.exec(src))) {
    const name = m[1];
    const fields: Field[] = [];
    const uniques: string[][] = [];
    let idField = "id";
    for (const raw of m[2].split("\n")) {
      const line = raw.replace(/\/\/\/.*$/, "").replace(/\/\/.*$/, "").trim();
      if (!line) continue;
      if (line.startsWith("@@unique")) { uniques.push(line.match(/\[([^\]]+)\]/)![1].split(",").map((s) => s.trim())); continue; }
      if (line.startsWith("@@id")) { const ks = line.match(/\[([^\]]+)\]/)![1].split(",").map((s) => s.trim()); uniques.push(ks); idField = ks.join("_"); continue; }
      if (line.startsWith("@@")) continue;
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!fm) continue;
      const [, fname, ftype, list, opt, attrs] = fm;
      const rel = /@relation\(([^)]*)\)/.exec(attrs);
      const f: Field = { name: fname, type: ftype, list: !!list, optional: !!opt, isRelation: !SCALARS.has(ftype) && !enums.has(ftype), isId: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs), hasDefaultNow: /@default\(now\(\)\)/.test(attrs), updatedAt: /@updatedAt/.test(attrs) };
      if (rel) {
        const fl = /fields:\s*\[([^\]]+)\]/.exec(rel[1]); const rf = /references:\s*\[([^\]]+)\]/.exec(rel[1]); const rn = /^\s*"([^"]+)"/.exec(rel[1]);
        if (fl) f.relFields = fl[1].split(",").map((s) => s.trim());
        if (rf) f.relRefs = rf[1].split(",").map((s) => s.trim());
        if (rn) f.relName = rn[1];
      }
      const dv = /@default\(([^)]*)\)/.exec(attrs);
      if (dv && !f.hasDefaultNow && !/cuid|uuid|autoincrement/.test(dv[1])) {
        const v = dv[1].trim();
        f.defaultValue = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"|"$/g, "");
      }
      if (f.isId) idField = fname;
      if (f.unique) uniques.push([fname]);
      fields.push(f);
    }
    models.set(name, { name, fields, uniques, idField });
  }
  // enum-typed fields are scalars
  for (const mod of models.values()) for (const f of mod.fields) if (enums.has(f.type)) f.isRelation = false;
  return { models, enums };
}

let seq = 0;
const cuid = () => `c${(++seq).toString(36).padStart(8, "0")}${Date.now().toString(36)}`;
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);

export class FakePrisma {
  private models: Map<string, Model>;
  private data = new Map<string, Record<string, unknown>[]>();
  [key: string]: unknown;

  constructor(schemaPath: string) {
    this.models = parseSchema(readFileSync(schemaPath, "utf8")).models;
    for (const name of this.models.keys()) {
      this.data.set(name, []);
      this[lower(name)] = this.delegate(name);
    }
  }

  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> { return fn(this); }
  async $disconnect() {}
  async $connect() {}
  dump(): Record<string, Record<string, unknown>[]> { return Object.fromEntries(this.data); }

  // ── relation resolution ──
  private reverse(model: Model, f: Field): { fk: string[]; refs: string[] } {
    const target = this.models.get(f.type)!;
    const back = target.fields.find((g) => g.isRelation && g.type === model.name && (f.relName ? g.relName === f.relName : true) && g.relFields);
    if (!back) throw new Error(`no back-relation for ${model.name}.${f.name}`);
    return { fk: back.relFields!, refs: back.relRefs! };
  }

  private resolve(model: Model, row: Record<string, unknown>, f: Field, sub: unknown): unknown {
    const target = this.models.get(f.type)!;
    const rows = this.data.get(target.name)!;
    const args = typeof sub === "object" && sub ? (sub as Record<string, unknown>) : {};
    if (f.relFields) {
      const found = rows.find((r) => f.relFields!.every((k, i) => r[f.relRefs![i]] === row[k]));
      return found ? this.shape(target, found, args) : null;
    }
    const { fk, refs } = this.reverse(model, f);
    let list = rows.filter((r) => fk.every((k, i) => r[k] === row[refs[i]]));
    if (f.list) {
      if (args.where) list = list.filter((r) => this.match(target, r, args.where as Record<string, unknown>));
      if (args.orderBy) list = this.sort(list, args.orderBy);
      if (typeof args.take === "number") list = list.slice(0, args.take);
      return list.map((r) => this.shape(target, r, args));
    }
    return list[0] ? this.shape(target, list[0], args) : null;
  }

  private shape(model: Model, row: Record<string, unknown>, args: Record<string, unknown>): Record<string, unknown> {
    const select = args.select as Record<string, unknown> | undefined;
    const include = args.include as Record<string, unknown> | undefined;
    const out: Record<string, unknown> = {};
    if (select) {
      for (const [k, v] of Object.entries(select)) {
        if (!v) continue;
        if (k === "_count") { out._count = this.count(model, row, v as Record<string, unknown>); continue; }
        const f = model.fields.find((x) => x.name === k)!;
        out[k] = f.isRelation ? this.resolve(model, row, f, v) : row[k];
      }
      return out;
    }
    Object.assign(out, row);
    if (include) {
      for (const [k, v] of Object.entries(include)) {
        if (!v) continue;
        if (k === "_count") { out._count = this.count(model, row, (v as { select: Record<string, unknown> }).select); continue; }
        const f = model.fields.find((x) => x.name === k);
        if (!f) throw new Error(`${model.name}: unknown include ${k}`);
        out[k] = this.resolve(model, row, f, v);
      }
    }
    return out;
  }

  private count(model: Model, row: Record<string, unknown>, sel: Record<string, unknown>) {
    const c: Record<string, number> = {};
    for (const k of Object.keys(sel)) { const f = model.fields.find((x) => x.name === k)!; c[k] = (this.resolve(model, row, f, {}) as unknown[]).length; }
    return c;
  }

  // ── where ──
  private match(model: Model, row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (k === "OR") { if (!(cond as Record<string, unknown>[]).some((w) => this.match(model, row, w))) return false; continue; }
      if (k === "AND") { if (!(cond as Record<string, unknown>[]).every((w) => this.match(model, row, w))) return false; continue; }
      if (k === "NOT") { if (this.match(model, row, cond as Record<string, unknown>)) return false; continue; }
      const f = model.fields.find((x) => x.name === k);
      if (!f) {
        // compound unique key a_b_c
        if (k.includes("_") && typeof cond === "object" && cond) { if (!this.match(model, row, cond as Record<string, unknown>)) return false; continue; }
        throw new Error(`${model.name}: unknown where field ${k}`);
      }
      if (f.isRelation) {
        const c = cond as Record<string, unknown>;
        if (f.list) {
          const rel = this.resolve(model, row, f, {}) as Record<string, unknown>[];
          const target = this.models.get(f.type)!;
          if ("some" in c && !rel.some((r) => this.match(target, r, c.some as Record<string, unknown>))) return false;
          if ("every" in c && !rel.every((r) => this.match(target, r, c.every as Record<string, unknown>))) return false;
          if ("none" in c && rel.some((r) => this.match(target, r, c.none as Record<string, unknown>))) return false;
        } else {
          const rel = this.resolve(model, row, f, {}) as Record<string, unknown> | null;
          if (!rel) return false;
          if (!this.match(this.models.get(f.type)!, rel, c)) return false;
        }
        continue;
      }
      if (!this.cmp(row[k], cond)) return false;
    }
    return true;
  }

  private cmp(v: unknown, cond: unknown): boolean {
    if (cond === null) return v === null || v === undefined;
    if (typeof cond !== "object" || cond instanceof Date) return this.eq(v, cond);
    const c = cond as Record<string, unknown>;
    const ci = c.mode === "insensitive";
    const s = (x: unknown) => (ci ? String(x).toLowerCase() : String(x));
    for (const [op, arg] of Object.entries(c)) {
      switch (op) {
        case "mode": break;
        case "equals": if (!(ci ? s(v) === s(arg) : this.eq(v, arg))) return false; break;
        case "in": if (!(arg as unknown[]).some((a) => this.eq(v, a))) return false; break;
        case "notIn": if ((arg as unknown[]).some((a) => this.eq(v, a))) return false; break;
        case "not": if (typeof arg === "object" && arg !== null && !(arg instanceof Date) ? this.cmp(v, arg) : this.eq(v, arg)) return false; break;
        case "contains": if (v == null || !s(v).includes(s(arg))) return false; break;
        case "startsWith": if (v == null || !s(v).startsWith(s(arg))) return false; break;
        case "lt": if (!(this.num(v) < this.num(arg))) return false; break;
        case "lte": if (!(this.num(v) <= this.num(arg))) return false; break;
        case "gt": if (!(this.num(v) > this.num(arg))) return false; break;
        case "gte": if (!(this.num(v) >= this.num(arg))) return false; break;
        default: throw new Error(`unsupported operator ${op}`);
      }
    }
    return true;
  }
  private num(x: unknown): number { return x instanceof Date ? x.getTime() : Number(x); }
  private eq(a: unknown, b: unknown): boolean { if (a instanceof Date || b instanceof Date) return this.num(a) === this.num(b); return a === b; }

  private sort(rows: Record<string, unknown>[], orderBy: unknown): Record<string, unknown>[] {
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, string>[];
    return [...rows].sort((a, b) => {
      for (const sp of specs) for (const [k, dir] of Object.entries(sp)) {
        const x = a[k], y = b[k];
        const c = x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : this.num(x) > this.num(y) || String(x) > String(y) && isNaN(this.num(x)) ? 1 : this.eq(x, y) ? 0 : -1;
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  // ── writes ──
  private checkUnique(model: Model, row: Record<string, unknown>, exceptId?: unknown) {
    for (const keys of model.uniques) {
      if (keys.some((k) => row[k] == null)) continue;
      const dup = this.data.get(model.name)!.find((r) => r[model.idField] !== exceptId && keys.every((k) => this.eq(r[k], row[k])));
      if (dup) throw new Error(`Unique constraint failed on ${model.name}(${keys.join(",")})`);
    }
  }

  private insert(model: Model, input: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const nested: [Field, unknown][] = [];
    for (const f of model.fields) {
      if (f.isRelation) { if (f.name in input) nested.push([f, input[f.name]]); continue; }
      if (f.name in input && input[f.name] !== undefined) row[f.name] = input[f.name]; // like Prisma: undefined means "not given"
      else if (f.isId) row[f.name] = cuid();
      else if (f.hasDefaultNow || f.updatedAt) row[f.name] = new Date();
      else if (f.defaultValue !== undefined) row[f.name] = f.defaultValue;
      else row[f.name] = null;
    }
    for (const f of model.fields) if (!f.isRelation && row[f.name] === undefined) row[f.name] = null;
    // to-one relation given as { connect: { id } }
    for (const [f, v] of nested) {
      if (f.relFields && v && typeof v === "object" && "connect" in (v as object)) {
        const target = this.models.get(f.type)!; const conn = (v as { connect: Record<string, unknown> }).connect;
        const t = this.data.get(target.name)!.find((r) => this.match(target, r, conn)); if (!t) throw new Error(`connect: ${f.type} not found`);
        f.relFields.forEach((k, i) => (row[k] = t[f.relRefs![i]]));
      }
    }
    this.checkUnique(model, row);
    this.data.get(model.name)!.push(row);
    // nested list create / connect
    for (const [f, v] of nested) {
      if (f.relFields) continue;
      const target = this.models.get(f.type)!; const { fk, refs } = this.reverse(model, f);
      const nv = v as { create?: unknown; connect?: unknown };
      for (const c of [nv.create].flat().filter(Boolean) as Record<string, unknown>[]) {
        const child = { ...c }; fk.forEach((k, i) => (child[k] = row[refs[i]])); this.insert(target, child);
      }
      for (const c of [nv.connect].flat().filter(Boolean) as Record<string, unknown>[]) {
        const t = this.data.get(target.name)!.find((r) => this.match(target, r, c)); if (!t) throw new Error(`connect: ${f.type} not found`);
        fk.forEach((k, i) => (t[k] = row[refs[i]]));
      }
    }
    return row;
  }

  private applyUpdate(model: Model, row: Record<string, unknown>, data: Record<string, unknown>) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      const f = model.fields.find((x) => x.name === k); if (!f) throw new Error(`${model.name}: unknown update field ${k}`);
      if (f.isRelation) {
        const target = this.models.get(f.type)!; const nv = v as { connect?: unknown; create?: unknown };
        if (f.relFields && nv.connect) { const t = this.data.get(target.name)!.find((r) => this.match(target, r, nv.connect as Record<string, unknown>))!; f.relFields.forEach((kk, i) => (next[kk] = t[f.relRefs![i]])); continue; }
        const { fk, refs } = this.reverse(model, f);
        for (const c of [nv.connect].flat().filter(Boolean) as Record<string, unknown>[]) { const t = this.data.get(target.name)!.find((r) => this.match(target, r, c))!; fk.forEach((kk, i) => (t[kk] = row[refs[i]])); }
        for (const c of [nv.create].flat().filter(Boolean) as Record<string, unknown>[]) { const child = { ...c }; fk.forEach((kk, i) => (child[kk] = row[refs[i]])); this.insert(target, child); }
        continue;
      }
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && "increment" in (v as object)) next[k] = Number(next[k] ?? 0) + Number((v as { increment: number }).increment);
      else next[k] = v;
    }
    for (const f of model.fields) if (f.updatedAt) next[f.name] = new Date();
    this.checkUnique(model, next, row[model.idField]);
    Object.assign(row, next);
  }

  private delegate(name: string) {
    const model = this.models.get(name)!;
    const rows = () => this.data.get(name)!;
    const query = (args: Record<string, unknown> = {}) => {
      let list = rows().filter((r) => this.match(model, r, args.where as Record<string, unknown>));
      if (args.orderBy) list = this.sort(list, args.orderBy);
      if (typeof args.skip === "number") list = list.slice(args.skip);
      if (typeof args.take === "number") list = list.slice(0, args.take);
      return list;
    };
    const one = (args: Record<string, unknown> = {}) => { const r = query(args)[0]; return r ? this.shape(model, r, args) : null; };
    const api = {
      findUnique: async (args: Record<string, unknown>) => one(args),
      findUniqueOrThrow: async (args: Record<string, unknown>) => { const r = one(args); if (!r) throw new Error(`${name} not found: ${JSON.stringify(args.where)}`); return r; },
      findFirst: async (args: Record<string, unknown> = {}) => one(args),
      findFirstOrThrow: async (args: Record<string, unknown> = {}) => { const r = one(args); if (!r) throw new Error(`${name} not found`); return r; },
      findMany: async (args: Record<string, unknown> = {}) => query(args).map((r) => this.shape(model, r, args)),
      count: async (args: Record<string, unknown> = {}) => query(args).length,
      create: async (args: { data: Record<string, unknown>; include?: unknown; select?: unknown }) => this.shape(model, this.insert(model, args.data), args as Record<string, unknown>),
      createMany: async (args: { data: Record<string, unknown>[] }) => { for (const d of args.data) this.insert(model, d); return { count: args.data.length }; },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown>; include?: unknown; select?: unknown }) => { const r = query({ where: args.where })[0]; if (!r) throw new Error(`${name} to update not found`); this.applyUpdate(model, r, args.data); return this.shape(model, r, args as Record<string, unknown>); },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { const l = query({ where: args.where }); l.forEach((r) => this.applyUpdate(model, r, args.data)); return { count: l.length }; },
      upsert: async (args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown>; select?: unknown; include?: unknown }) => { const r = query({ where: args.where })[0]; if (r) { this.applyUpdate(model, r, args.update); return this.shape(model, r, args as Record<string, unknown>); } return this.shape(model, this.insert(model, args.create), args as Record<string, unknown>); },
      delete: async (args: { where: Record<string, unknown> }) => { const r = query({ where: args.where })[0]; if (!r) throw new Error(`${name} to delete not found`); this.data.set(name, rows().filter((x) => x !== r)); return r; },
      deleteMany: async (args: { where?: Record<string, unknown> } = {}) => { const l = query({ where: args.where }); this.data.set(name, rows().filter((x) => !l.includes(x))); return { count: l.length }; },
      groupBy: async (args: { by: string[]; where?: Record<string, unknown>; _sum?: Record<string, boolean>; _count?: unknown }) => {
        const groups = new Map<string, Record<string, unknown>>();
        for (const r of query({ where: args.where })) {
          const key = args.by.map((k) => String(r[k])).join("|");
          const g = groups.get(key) ?? (() => { const o: Record<string, unknown> = {}; args.by.forEach((k) => (o[k] = r[k])); if (args._sum) o._sum = Object.fromEntries(Object.keys(args._sum).map((k) => [k, 0])); if (args._count) o._count = 0; groups.set(key, o); return o; })();
          if (args._sum) for (const k of Object.keys(args._sum)) (g._sum as Record<string, number>)[k] += Number(r[k] ?? 0);
          if (args._count) g._count = (g._count as number) + 1;
        }
        return [...groups.values()];
      },
    };
    return api;
  }
}

/** Drop-in for `new PrismaClient()` in dev harnesses. */
export class PrismaClient extends FakePrisma {
  constructor() { super(process.env.FAKE_PRISMA_SCHEMA ?? new URL("../../prisma/schema.prisma", import.meta.url).pathname); }
}
export const Prisma = { TransactionClient: undefined, JsonNull: null, DbNull: null };
