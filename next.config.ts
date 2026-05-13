import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "api.telegram.org" },
      { protocol: "https", hostname: "x.ai" }
    ]
  },
  serverExternalPackages: ["pdf-to-img"]
};

export default nextConfig;
