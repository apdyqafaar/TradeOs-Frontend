import { createQueryKeys } from "@/lib/query/keys";

/**
 * React Query keys for the digest slice.
 *
 * `latest()` is added alongside the generic `list`/`detail` pair rather than
 * folded into `detail("latest")`: `GET /digests/latest` is its own endpoint
 * with its own cache lifetime (short-poll while a run is in flight), and a
 * literal "latest" id would collide with `digestKeys.detail(id)` if the
 * backend ever minted a digest actually named `"latest"`.
 */
const base = createQueryKeys("digests");

export const digestKeys = {
  ...base,
  latest: () => ["digests", "latest"] as const,
};
