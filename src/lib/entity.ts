/** How a legal entity is shown in "所属法人" dropdowns: DCiT · 泰国 · TH · THB. The country name comes from messages (ui.country_XX). */
export function entityLabel(e: { code: string; countryCode: string; localCurrency: string }, u: { (key: string): string; has(key: string): boolean }): string {
  const country = u.has(`country_${e.countryCode}`) ? u(`country_${e.countryCode}`) : e.countryCode;
  return `${e.code} · ${country} · ${e.countryCode} · ${e.localCurrency}`;
}
