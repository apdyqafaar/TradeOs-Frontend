import { z } from "zod";

/**
 * Public environment, validated once at module load.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time only when the variable is
 * referenced as a literal `process.env.NEXT_PUBLIC_FOO` expression — a
 * computed lookup (`process.env[key]`) reads as `undefined` in the browser.
 * Every key below is therefore written out in full, and nothing else in the
 * app may read `process.env` directly.
 */
const publicEnvSchema = z.object({
  /**
   * Where the browser sends API calls. Defaults to the same-origin path that
   * `next.config.ts` rewrites to the Express server, which keeps the session
   * cookie first-party and removes CORS from the picture entirely.
   */
  NEXT_PUBLIC_API_BASE_URL: z.string().min(1).default("/api/v1"),
  /** The app's own origin, used for absolute links (share links, emails). */
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  // Fail loudly at boot rather than with an undefined base URL at the first
  // request — the same posture as the backend's `src/config/index.ts`.
  throw new Error(
    `Invalid public environment:\n${Object.entries(
      z.flattenError(parsed.error).fieldErrors,
    )
      .map(([key, messages]) => `  ${key}: ${messages?.join(", ")}`)
      .join("\n")}`,
  );
}

export const env = {
  apiBaseUrl: parsed.data.NEXT_PUBLIC_API_BASE_URL,
  appUrl: parsed.data.NEXT_PUBLIC_APP_URL,
} as const;

/**
 * Server-only values. Read on the server and in the Edge proxy: `proxy.ts`
 * reads the session cookie by name to decide whether to bounce an anonymous
 * request to `/login` (it never reads the cookie's *value*, which is opaque
 * and only meaningful to the API), `next.config.ts` rewrites `/api/v1/*` to
 * `apiOrigin`, and `lib/auth/server-session.ts` calls `GET /auth/me` on that
 * origin directly to decide whether a protected page may render at all.
 *
 * **These stay defaults rather than a schema that throws.** The public block
 * above fails loudly at boot because it can: every value it reads is inlined
 * into the browser bundle, so a missing one is missing everywhere. This block
 * cannot. `config/env.ts` is itself in the client bundle — `lib/api/client.ts`
 * imports `env` from here — and in the browser `process.env.API_ORIGIN` is
 * `undefined` by design. The object literal below is side-effect-free and so
 * gets tree-shaken out of that bundle (verified against `.next/static/chunks`:
 * `apiBaseUrl` is present there, this block's default is not), but a top-level
 * `throw` is a side effect no bundler may drop — it would ship to the browser
 * and take the whole client app down on load in production, which is a worse
 * failure than the one it was meant to prevent. Moving these two values into a
 * `server-only` module would make the throw safe; that is a larger change than
 * this line needs, and it is written up in
 * `docs/findings/slice3-server-auth.md`.
 *
 * The default therefore has to be *right*, not merely present.
 */
export const serverEnv = {
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "tradeos_session",
  // 8001, not 8000: `Backend/.env` sets `PORT=8001` and `.env.example` here
  // already matches it. The old 8000 default was masked by `.env.local` and
  // would have surfaced the day that file went missing — as a rewrite to a
  // dead port and, now that the app-shell layout gates on this origin, as
  // every signed-in user being bounced to `/login` by the fail-closed branch
  // in `readServerSession`.
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:8001",
} as const;
