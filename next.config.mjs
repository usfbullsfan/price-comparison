import { execSync } from "child_process";

const gitSha = process.env.BUILD_SHA
  || (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; } })();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_SHA: gitSha,
  },
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
