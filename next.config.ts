import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    proxyClientMaxBodySize: "50mb",
  },
  // Content-Security-Policy and Strict-Transport-Security are NOT here: the CSP carries a
  // per-request nonce, so it has to be built in `proxy.ts`. X-XSS-Protection is deliberately
  // gone — the legacy auditor it enabled is removed from every current browser and was itself
  // an XSS vector; `frame-ancestors 'none'` in the CSP supersedes X-Frame-Options.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
