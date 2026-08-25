import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
  serverExternalPackages: ["tesseract.js", "unpdf", "xlsx", "mammoth"],
};

export default nextConfig;
