import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  devIndicators: false, // the trial system runs `next dev`; its badge covered the page on a phone
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // The AWS server is small (1 GB): the type check alone took over 12 minutes of swapping there. Types are checked
  // before every release (tsc + the test run), so the server's build leaves that step out when told to.
  typescript: { ignoreBuildErrors: process.env.BUILD_SKIP_TYPECHECK === "1" },
};

export default withNextIntl(nextConfig);
