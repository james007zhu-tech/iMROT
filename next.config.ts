import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  devIndicators: false, // the trial system runs `next dev`; its badge covered the page on a phone
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default withNextIntl(nextConfig);
