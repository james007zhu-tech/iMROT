/** The brand a line of text names: "SINAMICS G120 … Siemens" → SIE. Longest name first, whole words only. */
export function guessBrand(text: string, brands: { code: string; name: string }[]): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9ก-๙一-鿿]+/g, " ")} `;
  const hit = [...brands].sort((a, b) => b.name.length - a.name.length).find((b) => b.name.length >= 3 && t.includes(` ${b.name.toLowerCase()} `));
  return hit?.code ?? null;
}
