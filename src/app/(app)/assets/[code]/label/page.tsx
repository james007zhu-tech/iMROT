import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Printable nameplate label: ATH + S/N + model + QR that opens the portal report form for this asset. ?n=12 prints 12 copies. */
export default async function Label({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ n?: string }> }) {
  const { code } = await params;
  const { n } = await searchParams;
  const asset = await prisma.asset.findUnique({ where: { code }, include: { model: { include: { series: { include: { brand: true } } } }, customer: true } });
  if (!asset) notFound();
  const base = process.env.PUBLIC_BASE_URL ?? "https://opth.ducheng-industrial.com";
  const qr = await QRCode.toDataURL(`${base}/portal/report?asset=${asset.code}`, { margin: 0, width: 240 });
  const copies = Math.min(Math.max(Number(n ?? 1), 1), 48);
  return (
    <div className="grid grid-cols-2 gap-4 bg-white p-4 print:grid-cols-3 print:gap-2">
      {Array.from({ length: copies }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded border border-navy p-3" style={{ breakInside: "avoid" }}>
          <img src={qr} alt={asset.code} className="h-24 w-24" />
          <div className="text-xs leading-tight">
            <div className="font-bold text-navy">DCiT</div>
            <div className="font-mono text-base font-bold">{asset.code}</div>
            <div>S/N <span className="font-mono">{asset.serialNumber}</span></div>
            <div>{asset.model ? `${asset.model.series.brand.name} ${asset.model.code}` : asset.type}</div>
            <div className="text-navy/70">{asset.customer?.name}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
