/** Pure text parsing for the offline assistant (src/server/ai-offline.ts): record numbers and a dictated new asset. */

/** Record numbers in free text: ATH26110002, QTTH26110504, INTH26110502, CTH2611002 … */
export function findCodes(text: string): { assets: string[]; docs: string[]; customers: string[] } {
  const up = text.toUpperCase();
  const all = [...up.matchAll(/\b([A-Z]{1,2})(TH|VN|CN)(\d{7,9})\b/g)].map((m) => m[0]);
  return {
    assets: all.filter((c) => /^A(TH|VN|CN)\d{8}$/.test(c)),
    customers: all.filter((c) => /^C(TH|VN|CN)\d{7}$/.test(c)),
    docs: all.filter((c) => /^[A-Z]{2}(TH|VN|CN)\d{8,9}$/.test(c)),
  };
}

const TYPE_WORDS: [RegExp, string][] = [[/变频器|变频|inverter|vfd|drive|อินเวอร์เตอร์/i, "VFD"], [/电机|马达|motor|มอเตอร์/i, "MOTOR"], [/\bplc\b/i, "PLC"], [/控制柜|电柜|panel|cabinet|ตู้/i, "PANEL"], [/传感器|sensor|เซนเซอร์/i, "SENSOR"]];

/** "新建设备 变频器 序列号 GRK-V-009 位置 Line 3" → { type: VFD, serialNumber: GRK-V-009, location: Line 3 } */
export function parseNewAsset(text: string): Record<string, string> | null {
  if (!/(新建|新增|建档|添加).{0,3}设备|new\s+asset|add\s+(an?\s+)?asset|เพิ่มอุปกรณ์|สร้างอุปกรณ์/i.test(text)) return null;
  const out: Record<string, string> = {};
  for (const [re, type] of TYPE_WORDS) if (re.test(text)) { out.type = type; break; }
  const grab = (labels: string) => new RegExp(`(?:${labels})\\s*[:：]?\\s*(.+?)(?=\\s+(?:序列号|位置|型号|客户资产编号|S\\/?N|serial|location|model|ซีเรียล|ตำแหน่ง|รุ่น)(?:\\s|[:：]|$)|$)`, "i").exec(text)?.[1]?.trim();
  const serial = grab("序列号|S\\/?N|serial(?:\\s*number)?|ซีเรียล");
  const location = grab("位置|location|ตำแหน่ง");
  const model = grab("型号|model|รุ่น");
  if (serial) out.serialNumber = serial.replace(/[，。,.]$/, "");
  if (location) out.location = location.replace(/[，。,.]$/, "");
  if (model) out.modelCode = model.replace(/[，。,.]$/, "");
  return out;
}
