/**
 * Business closure switch (decision 2026-11-05): until the trial run of every i/T flow has passed,
 * nothing that closes the money loop may happen — no TITH tax invoice, no IVTH invoice, no payment, no BLTH statement.
 * Everything up to acceptance and case archiving still works, so the full service flow can be tested.
 * Turn it on only after the trial passes: BUSINESS_CLOSURE=on in .env.
 */
export function businessClosureOn(): boolean {
  return (process.env.BUSINESS_CLOSURE ?? "off").trim().toLowerCase() === "on";
}

/** Services call this first; pages translate `err_CLOSURE_OFF`. */
export function assertBusinessClosure(step: "TI" | "IV" | "PAYMENT" | "BL"): void {
  if (!businessClosureOn()) throw new Error(`CLOSURE_OFF:${step}`);
}
