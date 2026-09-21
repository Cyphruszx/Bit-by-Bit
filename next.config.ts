import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
  transpilePackages: ["@fiskil/link"],
  serverExternalPackages: ["tesseract.js", "unpdf", "xlsx", "mammoth", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
