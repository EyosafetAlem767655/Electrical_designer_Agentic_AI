import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "api.telegram.org" },
      { protocol: "https", hostname: "x.ai" }
    ]
  },
  outputFileTracingIncludes: {
    "/api/jobs/process": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/wasm/**/*"
    ]
  },
  serverExternalPackages: ["pdf-to-img", "@napi-rs/canvas", "pdfjs-dist"]
};

export default nextConfig;
