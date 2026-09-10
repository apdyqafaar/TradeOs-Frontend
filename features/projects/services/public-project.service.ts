import { serverEnv } from "@/config/env";
import type {
  ProjectStatus,
  PublicProject,
  PublicProjectUpdate,
} from "../types";
import { PROJECT_STATUSES, SHARE_TOKEN_PATTERN } from "../types";

/**
 * `GET /public/projects/:token` — the one unauthenticated business route in the
 * whole API, and the only thing `app/p/[token]/page.tsx` calls.
 *
 * **Deliberately NOT `lib/api/client.ts`.** That is one axios instance built for
 * the browser: `withCredentials` (there is no ambient cookie jar on the
 * server), `baseURL: "/api/v1"` (relative to nothing on the server), a 401
 * interceptor that calls `window.location.assign`, and a shared React Query
 * cache it clears — every one of those is either meaningless or actively wrong
 * in a Server Component. This talks to the Express origin directly with `fetch`
 * and unwraps the one envelope it needs, exactly as
 * `lib/auth/server-session.ts` does for `/auth/me`.
 *
 * Fetching server-side is not an optimisation here, it is the point: the reader
 * is a client of the business, not a user of the product. There is no session,
 * no shell, no React Query provider and no client bundle to hydrate — the page
 * is HTML, and a share link opened on a phone with a bad connection either
 * renders or says it cannot.
 *
 * **The rate limit is now shared across every visitor, not every IP.** The
 * limiter is keyed on `req.ip` at 60 requests per 60 seconds
 * (`public.route.ts:18`, `rate-limit.middleware.ts:140-143`) with the bucket
 * name `"public-project"` and no token in the key. Because this call originates
 * on the Next server rather than in the reader's browser, **every public
 * project page in the product draws on one allowance** — the API sees one
 * client IP. Sixty page loads a minute across all share links is the ceiling,
 * and the 61st reader sees "not available". That is a deployment fact worth
 * knowing before a business emails a link to a hundred customers; it is
 * recorded in `docs/findings/slice5-projects.md`. It is also why the token is
 * shape-checked *here* rather than by asking the API: a crawler walking garbage
 * tokens would otherwise burn a shared budget on requests whose answer is
 * knowable locally.
 */

/** The envelope `Backend/src/util/responses.ts` wraps every body in. */
interface Envelope {
  success?: unknown;
  data?: unknown;
}

/**
 * How long to wait for the API before giving up.
 *
 * Shorter than the ten seconds `readServerSession` allows, because that one is
 * gating a signed-in user's own app and this one is a stranger holding a link:
 * a client who waits five seconds and is told the link is not available has
 * been treated better than one who watches a blank tab for ten.
 */
const TIMEOUT_MS = 5_000;

/**
 * A body is only a public project if it carries the fields the page renders.
 *
 * The same posture as `toSessionData`: a 200 that is not shaped like one — an
 * HTML error page from a proxy, a backend mid-deploy, a rewritten login screen
 * — is not a licence to render a project page. Everything unrecognised
 * collapses to `null`, which the page renders as "not available".
 *
 * It reads defensively rather than trusting the contract's key sets, because
 * this is the one payload in the product with no session behind it and nothing
 * upstream that has already validated it.
 */
function toPublicProject(body: unknown): PublicProject | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Envelope;
  if (envelope.success !== true) return null;

  const data = envelope.data;
  if (typeof data !== "object" || data === null) return null;

  const record = data as Record<string, unknown>;
  const business = asRecord(record.business);
  const project = asRecord(record.project);
  if (!business || !project) return null;

  // `business.name` is `""` — not null, not a 404 — when the organization row is
  // gone (`public-project.service.ts:46-47`). An empty string is a valid
  // payload, so it must not fail this guard; the page decides what to draw for
  // a business with no name.
  if (typeof business.name !== "string") return null;
  if (typeof project.title !== "string") return null;
  if (typeof project.progress !== "number") return null;
  if (!isProjectStatus(project.status)) return null;
  if (typeof project.updatedAt !== "string") return null;

  return {
    business: {
      name: business.name,
      logo: asString(business.logo),
    },
    project: {
      title: project.title,
      description: asString(project.description),
      status: project.status,
      progress: project.progress,
      startDate: asString(project.startDate),
      dueDate: asString(project.dueDate),
      updatedAt: project.updatedAt,
      cover: asCover(project.cover),
    },
    updates: asUpdates(record.updates),
  };
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const isProjectStatus = (value: unknown): value is ProjectStatus =>
  typeof value === "string" &&
  (PROJECT_STATUSES as readonly string[]).includes(value);

/** The public cover is `{ url, thumbUrl }` — there is no `uploadId` on it. */
function asCover(value: unknown): { url: string; thumbUrl: string } | null {
  const cover = asRecord(value);
  if (!cover) return null;
  const url = asString(cover.url);
  const thumbUrl = asString(cover.thumbUrl);
  return url && thumbUrl ? { url, thumbUrl } : null;
}

/**
 * The updates array, filtered to the entries that can actually be rendered.
 *
 * A malformed entry is dropped rather than failing the whole page: losing one
 * progress note is a smaller harm to a client following their job than losing
 * the project.
 */
function asUpdates(value: unknown): PublicProjectUpdate[] {
  if (!Array.isArray(value)) return [];

  const updates: PublicProjectUpdate[] = [];
  for (const entry of value) {
    const update = asRecord(entry);
    if (!update) continue;
    const body = asString(update.body);
    const createdAt = asString(update.createdAt);
    if (!body || !createdAt) continue;
    updates.push({
      body,
      // `null` when the note carried no progress. `0` is a real value, so this
      // cannot be a truthiness check.
      progress: typeof update.progress === "number" ? update.progress : null,
      createdAt,
    });
  }
  return updates;
}

/**
 * The project behind a share token, or `null` if there is nothing to show.
 *
 * **`null` covers every failure and they are deliberately not distinguished.**
 * A wrong token, a malformed one, an unpublished project, a regenerated link, a
 * 429, a 5xx, a timeout, a backend that never answers — all one answer, because
 * the route's whole design goal is that a prober learns nothing: the 404 bodies
 * are byte-identical across a wrong token, `abc` and `"f".repeat(64)`, asserted
 * with `toEqual` by `public-link.test.ts:168-191`. Branching on status here
 * would re-introduce the oracle the backend went out of its way to remove — and
 * it would branch wrong anyway, since a token over 128 characters answers
 * **422**, not 404 (`public.route.ts:19`, contract §3.7).
 *
 * The caller must not wrap this in a `try`: it never throws.
 *
 * `cache: "no-store"` matches the route's own `Cache-Control: no-store`
 * (`public.controller.ts:16-17`) and is a correctness requirement rather than a
 * tuning choice — an unpublish takes effect instantly on the API, and a page
 * cached here would keep serving a project whose owner has revoked it.
 */
export async function fetchPublicProject(
  token: string,
): Promise<PublicProject | null> {
  // Lowercase 64-hex, checked locally. `SHARE_TOKEN_REGEX` on the server is the
  // same pattern and is **lowercase-only** — a correctly-hex but upper-cased
  // token 404s there (`project.validation.ts:85`, verified in contract §3.1) —
  // so nothing here may normalise case on the way past. Anything that cannot
  // possibly match is refused without spending a request from the shared
  // allowance described at the top of this file.
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;

  try {
    const response = await fetch(
      // Already known to be 64 hex characters, so this cannot inject a path
      // segment; encoded anyway, because the guard above is the kind of line a
      // later edit relaxes.
      `${serverEnv.apiOrigin}/api/v1/public/projects/${encodeURIComponent(token)}`,
      {
        headers: { accept: "application/json" },
        // No cookies, no credentials: this route has no auth chain at all
        // (`public.route.ts:16-21`), and forwarding a reader's cookies to it
        // would be sending someone's session somewhere it is not needed.
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) return null;
    return toPublicProject(await response.json());
  } catch {
    // Unreachable, aborted, or a body that is not JSON. One answer, as above.
    return null;
  }
}
