import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdfjs-dist", "mammoth", "postgres", "js-tiktoken"],
  outputFileTracingIncludes: { "/*": ["./fixtures/documents/**/*", "./fixtures/truth/**/*", "./fixtures/golden/**/*", "./eval/baselines/**/*"] },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
