/** The word the middleware and /api/gate share: derived from the session secret, never sent to a browser. */
export function gateKey(): string {
  const s = process.env.SESSION_SECRET ?? "dev";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `g${(h >>> 0).toString(36)}${s.length}`;
}
