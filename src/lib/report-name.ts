/**
 * Download file names: document number + the report's name in the reader's language, e.g. QTTH261108004_报价建议书.pdf.
 * Menu labels may carry the number prefix and a note ("税务发票 TITH（正本 + 副本）"); the file name keeps only the name.
 */
export function reportFileLabel(label: string): string {
  return label.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+[A-Z]{4}\s*$/, "").trim();
}

export function reportFileName(no: string, label: string, ext: ".pdf" | ".docx"): string {
  const name = reportFileLabel(label);
  return `${no}${name ? `_${name}` : ""}${ext}`.replace(/[\\/:*?"<>|]/g, "-");
}
