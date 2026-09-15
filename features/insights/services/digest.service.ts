import type {
  Digest,
  DigestQuota,
  DigestSummary,
  RunDigestResult,
} from "@/features/insights/types";
import { apiGet, apiGetList, apiPost } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";

/**
 * All four `/digests` rows in `docs/API-ROUTES.md`.
 *
 * No React here: these are called from hooks and from tests, and a `useQuery`
 * import would make the second impossible.
 */
const BASE = "/digests";

/** `GET /digests/latest` — `reports:view`. A 404 means "no digest yet". */
export const getLatestDigest = (): Promise<Digest> =>
  apiGet<Digest>(`${BASE}/latest`);

/** `GET /digests/:id` — `reports:view`. Carries the full tool `trace`. */
export const getDigest = (id: string): Promise<Digest> =>
  apiGet<Digest>(`${BASE}/${id}`);

/**
 * `GET /digests` — `reports:view`, paginated, so `apiGetList`.
 *
 * `apiGetList(BASE, params)` — passing the params object directly as the
 * second argument — is the trap already documented next to every other
 * `apiGetList` call in this repo (`features/projects/services/project.service.ts`,
 * `features/customers/services/customer.service.ts`, …): `apiGetList`'s
 * second parameter is an `AxiosRequestConfig`, not a raw query object, so it
 * must be wrapped as `{ params }` or axios sends no query string at all and
 * the caller is stuck on page 1.
 */
export const listDigests = (params: {
  page: number;
  limit: number;
}): Promise<Paginated<DigestSummary>> =>
  apiGetList<DigestSummary>(BASE, { params });

/** `POST /digests/run` — `organization:update`. 202 — the digest lands about a minute later; callers poll `getLatestDigest`. */
export const runDigest = (): Promise<RunDigestResult> =>
  apiPost<RunDigestResult>(`${BASE}/run`, {});

/**
 * `GET /digests/quota` — the manual-run allowance, answered **even when the
 * shop has no digest at all**, which is why it is its own request rather than
 * a field on `latest`: the empty screen is exactly where "3 of 3 left today"
 * belongs.
 *
 * **Not in `docs/API-ROUTES.md` and not in the backend router as of
 * 2026-09-15.** Everything else in this file was checked against that table
 * first, per CLAUDE.md; this one is written against the rebuild brief's
 * forecast of a contract still being built. `useDigestQuota` therefore treats
 * every failure as "do not render the line", so a frontend deployed ahead of
 * the API shows no quota rather than an error.
 */
export const getDigestQuota = (): Promise<DigestQuota> =>
  apiGet<DigestQuota>(`${BASE}/quota`);
