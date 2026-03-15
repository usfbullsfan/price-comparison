import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.walmart.com" },
      { protocol: "https", hostname: "**.target.com" },
      { protocol: "https", hostname: "**.publix.com" },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ["tesseract.js", "sharp"],
  },
};

export default nextConfig;
