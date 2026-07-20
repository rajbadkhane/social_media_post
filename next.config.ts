import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["fontkit"],
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/*": [
      "./assets/poster/**/*",
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-900-normal.woff2",
      "./node_modules/@fontsource/anek-devanagari/files/anek-devanagari-devanagari-800-normal.woff2",
    ],
  },
};

export default nextConfig;
