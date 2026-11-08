import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = { title: "DCiT OS", description: "iMROT — equipment-centred service operations", manifest: "/manifest.json", icons: {
  // Option C chosen 2026-11-08: the logo's "i" with its square dot on a navy tile, drawn pixel-exact at 16 and 32 px (docs/brand/favicon*.svg).
  icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }, { url: "/icon-16.png", sizes: "16x16", type: "image/png" }, { url: "/icon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
} };
export const viewport = { themeColor: "#0B2D53", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
