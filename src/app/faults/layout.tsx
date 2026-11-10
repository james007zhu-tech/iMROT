/** Public fault-code pages: no login, mobile first, DCiT branding. They read the published table only. */
export default function FaultsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white text-navy">{children}</div>;
}
