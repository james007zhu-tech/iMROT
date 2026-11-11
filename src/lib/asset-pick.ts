/** A search text that could be a serial number (not an ATH code, has a digit, no spaces): offered as the S/N of a new machine. */
export const looksLikeSerial = (q: string) => !/^A(TH|VN|CN)\d/i.test(q.trim()) && /\d/.test(q) && !/\s/.test(q.trim()) && q.trim().length >= 4;
/** "?a=ATH1,ATH2&a=ATH3" → distinct codes in order. */
export const codesFrom = (v: string | string[] | undefined) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(",")).map((x) => x.trim().toUpperCase()).filter(Boolean))];
