"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Side navigation; the current module is highlighted. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col">
      {items.map((n) => {
        const on = path === n.href || path.startsWith(`${n.href}/`);
        return <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${on ? "bg-white/15 text-white" : "text-white/85 hover:bg-white/10"}`}>{n.label}</Link>;
      })}
    </nav>
  );
}
