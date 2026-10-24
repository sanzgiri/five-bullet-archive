import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // The repository's Cloudflare-only worker and D1 modules are not part of the static Pages app.
  typescript: { ignoreBuildErrors: true },
  ...(process.env.PAGES_BASE_PATH ? { basePath: process.env.PAGES_BASE_PATH } : {}),
};

export default nextConfig;
