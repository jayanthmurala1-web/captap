import type { NextConfig } from "next";

// Baseline browser protections on every response. No CSP yet: the editor and embeds need inline
// styles/scripts, and a wrong CSP silently breaks pages; add one deliberately, with a report-only pass first.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // Editor image uploads go through a server action; images are capped at 10 MB (lib/cloudinary.ts).
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
