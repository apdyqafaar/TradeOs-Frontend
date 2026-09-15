import type {
  Digest,
  DigestQuota,
  DigestSummary,
  RunDigestInput,
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

/**
 * `POST /digests/run` — `organization:update`. 202; the digest lands about a
 * minute later and callers poll `getLatestDigest`.
 *
 * The body is new: a `preset` from `DIGEST_PERIOD_PRESETS`, plus `from`/`to`
 * for `custom` only. `runDigestBodySchema` is `.strict()` and refuses a range
 * sent with any other preset rather than dropping it — so a period sent by
 * mistake is a 422, not a digest over a window nobody asked for. Sending `{}`
 * is still valid and still means today, which is why the parameter is
 * optional.
 *
 * The 202 carries `{ localDate, period, quota }`: the allowance comes back
 * inline, so nothing needs to refetch `GET /digests/quota` afterwards.
 */
export const runDigest = (
  input: RunDigestInput = {},
): Promise<RunDigestResult> =>
  apiPost<RunDigestResult>(`${BASE}/run`, {
    /**
     * **The wire field is `period`, and it holds the PRESET STRING** —
     * `runDigestBodySchema` is `period: z.enum(DIGEST_PERIOD_PRESETS)`, and the
     * controller renames it to `preset` on its way into the service. The 202
     * comes back with a `period` that is an *object* (`{preset, from, to}`), so
     * the one name means two different shapes in the two directions.
     *
     * This is the only place that asymmetry exists. The app-side type calls the
     * request field `preset`, matching the resolved object's own key, and the
     * mapping happens here where the schema is quoted beside it. Sending
     * `{ preset }` instead would be silently dropped by `.strict()` — no, worse
     * than dropped: `.strict()` makes it a 422, which is at least loud.
     */
    ...(input.preset ? { period: input.preset } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
  });

/**
 * `GET /digests/quota` — the manual-run allowance, answered **even when the
 * shop has no digest at all**, which is why it is its own request rather than
 * a field on `latest`: the empty screen is exactly where "2 of 2 left today"
 * belongs.
 *
 * Gated `reports:view`, not `organization:update` — reading how many runs are
 * left is not spending one, and every artboard renders the count including for
 * a viewer who can never press Generate.
 */
export const getDigestQuota = (): Promise<DigestQuota> =>
  apiGet<DigestQuota>(`${BASE}/quota`);
