"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** One line icon per module, so the menu reads as a tidy column whatever the label length. */
const ICONS: Record<string, React.ReactNode> = {
  dash: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  alm: <><rect x="5" y="2.5" width="14" height="19" rx="2" /><rect x="8" y="5.5" width="8" height="4" rx="1" /><path d="M8 13h8M8 16.5h5" /></>,
  crm: <><path d="M3 21h18M5 21V7l7-4v18M12 9h7v12" /><path d="M8 10v.01M8 13.5v.01M8 17v.01M15.5 13v.01M15.5 16.5v.01" /></>,
  slm: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />,
  scm: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  fin: <><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><circle cx="16.5" cy="14.5" r="1.4" /></>,
  to: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11h6M9 14.5h4" /></>,
  opd: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.3.3 4 2 4.5 4.9" /></>,
  admin: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
};

/** Side navigation on white (decision 2026-11-07): icon + label, the current module on a light blue ground with a blue bar. */
export function NavLinks({ items }: { items: { key: string; href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:gap-0.5">
      {items.map((n) => {
        const on = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
            className={`relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[14.5px] tracking-wide ${on ? "bg-[#EEF3F9] font-bold text-navy before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded before:bg-blue" : "text-[#4A5A6E] hover:bg-[#F4F7FB] hover:text-navy"}`}>
            <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] shrink-0 fill-none stroke-current" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{ICONS[n.key]}</svg>
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
