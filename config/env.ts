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
 * Server-only values. `proxy.ts` reads the session cookie by name to decide
 * whether to bounce an anonymous request to `/login`; it never reads the
 * cookie's value, which is opaque and only meaningful to the API.
 */
export const serverEnv = {
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "tradeos_session",
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:8000",
} as const;
