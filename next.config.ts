import type { NextConfig } from "next";
import { serverEnv } from "./config/env";

/**
 * Build-time only, so it is read straight off `process.env` rather than through
 * `config/env.ts` (which validates what the *app* may read). An unset value
 * yields an empty `remotePatterns`, which is Next's "no remote images allowed"
 * default rather than a boot failure — local development has no S3 bucket.
 */
const s3Hostname = process.env.NEXT_PUBLIC_S3_HOSTNAME;

const nextConfig: NextConfig = {
  reactCompiler: true,

  /**
   * The browser must call the API on this origin, never on the Express origin
   * directly. Three reasons, all of them the session cookie:
   *   - The cookie is HttpOnly and set for the API's host; a cross-origin fetch
   *     would need SameSite=None plus credentials, which drops the CSRF
   *     protection SameSite=Lax gives for free.
   *   - Same-origin means no preflight and no CORS allowlist to keep in sync.
   *   - `proxy.ts` can only read a cookie that belongs to this origin, so the
   *     optimistic /login bounce depends on the cookie being first-party.
   */
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${serverEnv.apiOrigin}/api/v1/:path*`,
      },
    ];
  },

  experimental: {
    // lucide-react has ~1,600 single-icon modules; without this every one of
    // them is pulled into the dev graph on the first import.
    optimizePackageImports: ["lucide-react"],
  },

  images: {
    remotePatterns: s3Hostname
      ? [{ protocol: "https", hostname: s3Hostname }]
      : [],
  },

  // `typedRoutes: true` is stable in Next 16 and is what we want eventually,
  // but it types `Link href` as a union of routes that actually exist. Half the
  // paths in `config/routes.ts` have no page yet, so turning it on now makes
  // every nav item a type error. Enable it once the route tree is complete.
};

export default nextConfig;
