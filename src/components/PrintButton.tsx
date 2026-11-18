"use client";
/** 打印 / 存为 PDF: the browser's print dialogue — "Save as PDF" there gives the file. */
export function PrintButton({ label, className }: { label: string; className?: string }) {
  return <button type="button" onClick={() => window.print()} className={className ?? "rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white print:hidden"}>{label}</button>;
}
