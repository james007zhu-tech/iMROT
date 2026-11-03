/** Dependency-free SVG charts for dashboards. Server-renderable; colours from the DCiT palette. */
import type { Series } from "@/lib/metrics";

const PALETTE = ["#2374D5", "#0B2D53", "#5BA8F5", "#1E5AA8", "#8DBEF0", "#3E6A99", "#B9D6F6", "#16426F", "#6E9CCB", "#F2A33A"]; // navy/blue family; orange last (alarm colour)
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n * 10) / 10));

export function Kpi({ data, title }: { data: Series; title: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="text-sm text-navy/70">{title}</div>
      <div className="text-3xl font-bold text-navy">{fmt(data.values[0] ?? 0)}{data.unit ? <span className="ml-1 text-base font-normal text-navy/70">{data.unit}</span> : null}</div>
    </div>
  );
}

export function BarChart({ data, height = 200 }: { data: Series; height?: number }) {
  const W = 600, H = height, padL = 40, padB = 48, padT = 10;
  const max = Math.max(1, ...data.values);
  const n = data.values.length || 1;
  const bw = (W - padL - 10) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - 10} y1={padT + (H - padB - padT) * (1 - t)} y2={padT + (H - padB - padT) * (1 - t)} stroke="rgba(11,45,83,.15)" /><text x={padL - 4} y={padT + (H - padB - padT) * (1 - t) + 4} fontSize="10" textAnchor="end" fill="rgba(11,45,83,.7)">{fmt(max * t)}</text></g>)}
      {data.values.map((v, i) => {
        const h = (H - padB - padT) * (v / max);
        const x = padL + i * bw + bw * 0.15;
        return <g key={i}><rect x={x} y={H - padB - h} width={bw * 0.7} height={h} rx="3" fill={PALETTE[0]} /><text x={x + bw * 0.35} y={H - padB - h - 3} fontSize="10" textAnchor="middle" fill="#0B2D53">{v ? fmt(v) : ""}</text><text x={x + bw * 0.35} y={H - padB + 14} fontSize="10" textAnchor="middle" fill="#0B2D53">{short(data.labels[i], n)}</text></g>;
      })}
    </svg>
  );
}

export function LineChart({ data, height = 200 }: { data: Series; height?: number }) {
  const W = 600, H = height, padL = 40, padB = 40, padT = 10;
  const max = Math.max(1, ...data.values);
  const n = data.values.length;
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * (W - padL - 10) : 0);
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / max);
  const d = data.values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - 10} y1={y(max * t)} y2={y(max * t)} stroke="rgba(11,45,83,.15)" /><text x={padL - 4} y={y(max * t) + 4} fontSize="10" textAnchor="end" fill="rgba(11,45,83,.7)">{fmt(max * t)}</text></g>)}
      <path d={d} fill="none" stroke={PALETTE[0]} strokeWidth="2" />
      {data.values.map((v, i) => <g key={i}><circle cx={x(i)} cy={y(v)} r="3" fill={PALETTE[0]} /><text x={x(i)} y={H - padB + 14} fontSize="10" textAnchor="middle" fill="#0B2D53">{short(data.labels[i], n)}</text></g>)}
    </svg>
  );
}

export function Donut({ data, size = 180 }: { data: Series; size?: number }) {
  const total = data.values.reduce((s, v) => s + v, 0) || 1;
  const r = 70, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 180 180" width={size} height={size} role="img">
        {data.values.map((v, i) => { const len = (v / total) * c; const el = <circle key={i} r={r} cx="90" cy="90" fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="26" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)" />; acc += len; return el; })}
        <text x="90" y="95" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0B2D53">{fmt(total)}</text>
      </svg>
      <ul className="text-xs">{data.labels.map((l, i) => <li key={l} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />{l} <b>{fmt(data.values[i])}</b> <span className="text-navy/50">{Math.round((data.values[i] / total) * 100)}%</span></li>)}</ul>
    </div>
  );
}

export function DataTable({ data }: { data: Series }) {
  return (
    <table className="w-full text-sm"><tbody>{data.labels.map((l, i) => <tr key={l} className="border-t"><td className="py-1">{l}</td><td className="py-1 text-right font-mono">{fmt(data.values[i])}{data.unit ? ` ${data.unit}` : ""}</td></tr>)}</tbody></table>
  );
}

function short(s: string, n: number) { const max = n > 8 ? 7 : 12; return s.length > max ? s.slice(0, max - 1) + "…" : s; }

export function ChartFor({ chart, data, title }: { chart: string; data: Series; title: string }) {
  switch (chart) {
    case "kpi": return <Kpi data={data} title={title} />;
    case "line": return <LineChart data={data} />;
    case "donut": return <Donut data={data} />;
    case "table": return <DataTable data={data} />;
    default: return <BarChart data={data} />;
  }
}
