import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    // Server actions carry form fields and at most one ~1 MB base64 featured image; issue PDFs
    // (50 MB) never pass through a server action — the browser PUTs them straight to S3 with a
    // presigned URL and the action only stores the key. 50 MB here was an accidental DoS lever
    // on a 1 GB box.
    serverActions: {
      bodySizeLimit: "2mb",
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
