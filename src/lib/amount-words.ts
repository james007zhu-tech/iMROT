/**
 * Amounts in words for tax invoices and receipts (rule: every TITH / RCTH prints the total in Thai and English).
 * Thai follows the Revenue Department style: "สามหมื่นสองพันหนึ่งร้อยบาทถ้วน", satang as "…บาทห้าสิบสตางค์".
 */
const TH_DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const TH_POS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Integer < 1,000,000 → Thai words (empty for 0). */
function thaiBelowMillion(n: number, hasHigher = false): string {
  if (n === 0) return "";
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const digit = Number(s[i]);
    const pos = s.length - 1 - i;
    if (digit === 0) continue;
    if (pos === 0 && digit === 1 && (s.length > 1 || hasHigher)) out += "เอ็ด";
    else if (pos === 1 && digit === 1) out += "สิบ";
    else if (pos === 1 && digit === 2) out += "ยี่สิบ";
    else out += TH_DIGITS[digit] + TH_POS[pos];
  }
  return out;
}

export function thaiInteger(n: number): string {
  if (n === 0) return "ศูนย์";
  let out = "";
  let rest = Math.floor(Math.abs(n));
  const groups: number[] = [];
  while (rest > 0) { groups.unshift(rest % 1_000_000); rest = Math.floor(rest / 1_000_000); }
  groups.forEach((g, i) => {
    const words = thaiBelowMillion(g, i > 0);
    const isLast = i === groups.length - 1;
    out += words;
    if (!isLast && (words || out)) out += "ล้าน";
  });
  return out;
}

/** 32100 → "สามหมื่นสองพันหนึ่งร้อยบาทถ้วน"; 1250.5 → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์" */
export function thaiBaht(amount: number): string {
  const sign = amount < 0 ? "ลบ" : "";
  const abs = Math.abs(amount);
  const baht = Math.floor(abs + 1e-9);
  const satang = Math.round((abs - baht) * 100);
  if (baht === 0 && satang === 0) return "ศูนย์บาทถ้วน";
  const b = baht > 0 ? `${thaiInteger(baht)}บาท` : "";
  return `${sign}${b}${satang > 0 ? `${thaiBelowMillion(satang)}สตางค์` : "ถ้วน"}`;
}

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function englishBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(EN_ONES[n]);
  return parts.join(" ");
}

export function englishInteger(n: number): string {
  if (n === 0) return "zero";
  const scales = ["", " thousand", " million", " billion", " trillion"];
  const parts: string[] = [];
  let rest = Math.floor(Math.abs(n));
  let i = 0;
  while (rest > 0) { const g = rest % 1000; if (g) parts.unshift(englishBelowThousand(g) + scales[i]); rest = Math.floor(rest / 1000); i++; }
  return parts.join(" ");
}

const CURRENCY_NAMES: Record<string, { unit: string; cent: string }> = {
  THB: { unit: "baht", cent: "satang" }, USD: { unit: "US dollars", cent: "cents" }, CNY: { unit: "yuan", cent: "fen" }, EUR: { unit: "euro", cent: "cents" }, JPY: { unit: "yen", cent: "sen" }, VND: { unit: "dong", cent: "xu" },
};

/** 32100 THB → "Thirty-two thousand one hundred baht only" */
export function englishAmount(amount: number, currency = "THB"): string {
  const c = CURRENCY_NAMES[currency] ?? { unit: currency, cent: "cents" };
  const abs = Math.abs(amount);
  const major = Math.floor(abs + 1e-9);
  const minor = Math.round((abs - major) * 100);
  const words = `${englishInteger(major)} ${c.unit}${minor ? ` and ${englishInteger(minor)} ${c.cent}` : ""} only`;
  return (amount < 0 ? "minus " : "") + words.charAt(0).toUpperCase() + words.slice(1);
}

/** Thai words for a non-THB amount: "สามหมื่นสองพันหนึ่งร้อยดอลลาร์สหรัฐถ้วน" — used on receipts for foreign-currency invoices. */
const TH_CURRENCY: Record<string, string> = { THB: "บาท", USD: "ดอลลาร์สหรัฐ", CNY: "หยวน", EUR: "ยูโร", JPY: "เยน", VND: "ดอง" };
export function thaiAmount(amount: number, currency = "THB"): string {
  if (currency === "THB") return thaiBaht(amount);
  const abs = Math.abs(amount);
  const major = Math.floor(abs + 1e-9);
  const minor = Math.round((abs - major) * 100);
  return `${amount < 0 ? "ลบ" : ""}${thaiInteger(major)}${TH_CURRENCY[currency] ?? currency}${minor ? `${thaiBelowMillion(minor)}เซนต์` : "ถ้วน"}`;
}
