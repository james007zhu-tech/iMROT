/**
 * Contact details are masked by default (decision 2026-11-03); showing them in full needs the password again.
 * Name keeps the honorific and first letter, phone keeps the first and last two digits, email keeps
 * the first letter of the mailbox and the first letter + suffix of the domain.
 */
const HONORIFIC = /^(?:khun\s+|คุณ\s*|mr\.?\s+|mrs\.?\s+|ms\.?\s+|miss\s+|dr\.?\s+)/i;

export function maskName(name: string | null | undefined): string {
  if (!name) return "";
  const m = HONORIFIC.exec(name);
  const rest = m ? name.slice(m[0].length) : name;
  return `${m ? m[0] : ""}${[...rest][0] ?? ""}****`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "").length;
  let seen = 0;
  return phone.replace(/\d/g, (d) => { seen++; return seen <= 2 || seen > digits - 2 ? d : "*"; });
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain = ""] = email.split("@");
  const dot = domain.indexOf(".");
  return `${local[0] ?? ""}****@${domain[0] ?? ""}***${dot >= 0 ? domain.slice(dot) : ""}`;
}

export function maskLogin(login: string | null | undefined): string {
  if (!login) return "";
  return `${login[0]}${"*".repeat(Math.max(3, login.length - 1))}`;
}

/** Replace each given name (longest first) by its masked form in every text and list field of a report. */
export function maskNamesIn<V extends Record<string, unknown>>(values: V, names: string[]): V {
  if (!names.length) return values;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const fix = (v: unknown) => (typeof v === "string" ? sorted.reduce((s, n) => s.split(n).join(maskName(n)), v) : v);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v.map(fix) : fix(v)])) as V;
}
