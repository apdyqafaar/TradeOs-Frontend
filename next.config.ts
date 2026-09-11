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
   * Lets a phone on the shop's WiFi open `http://192.168.1.x:3000` without the
   * page reloading itself every few seconds.
   *
   * `next dev` is initialised with the hostname `localhost`, and Next refuses
   * cross-origin requests to its **dev-only** resources — anything under
   * `/_next` or `/__nextjs` — from any other host
   * (`next/dist/server/lib/router-utils/block-cross-site-dev.js`). Reaching the
   * server by LAN address makes every such request come from
   * `192.168.1.x:3000`, which is not `localhost`.
   *
   * Most of the page survives that, which is what makes it confusing to
   * diagnose: ordinary asset and RSC requests from the phone are *same-origin*,
   * so the browser sends no `Origin` header and the check lets them through.
   * **The HMR WebSocket is the exception.** A WebSocket handshake always sends
   * `Origin`, and its endpoint is under `/_next`, so it is answered `403
   * Unauthorized`; the dev client then treats the dead socket as a lost
   * connection and reloads the page to recover, over and over. On the login
   * screen that lands mid-typing and reads as "it refreshes when I try to log
   * in".
   *
   * A `/24` wildcard rather than one address because the machine's IP comes
   * from DHCP and changes; pinning it would fail silently the next time the
   * router hands out a different lease. Matching is per dot-separated segment,
   * so `192.168.1.*` covers exactly that subnet and nothing wider
   * (`next/dist/server/app-render/csrf-protection.js`). `localhost` is always
   * allowed and is not affected by this. Development only — `next build` and
   * `next start` never read it.
   */
  allowedDevOrigins: ["192.168.1.*"],

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
