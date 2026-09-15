"use client";

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { digestKeys } from "@/features/insights/keys";
import {
  getDigest,
  getDigestQuota,
  getLatestDigest,
  listDigests,
  runDigest,
} from "@/features/insights/services/digest.service";
import type {
  Digest,
  DigestQuota,
  DigestSummary,
  RunDigestResult,
} from "@/features/insights/types";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";

/** A 404 is "no digest yet" — an answer. `retry: false` says so out loud. */
export function useLatestDigest(
  options: { pollMs?: number } = {},
): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({
    queryKey: digestKeys.latest(),
    queryFn: getLatestDigest,
    refetchInterval: options.pollMs ?? false,
    retry: false,
  });
}

export function useDigest(id: string): UseQueryResult<Digest, ApiError> {
  return useQuery<Digest, ApiError>({
    queryKey: digestKeys.detail(id),
    queryFn: () => getDigest(id),
  });
}

export function useDigests(
  page: number,
  limit: number,
): UseQueryResult<Paginated<DigestSummary>, ApiError> {
  return useQuery<Paginated<DigestSummary>, ApiError>({
    queryKey: digestKeys.list({ page, limit }),
    queryFn: () => listDigests({ page, limit }),
  });
}

/**
 * How many manual runs are left today, or `null` when the answer is not
 * available for any reason at all.
 *
 * **Every failure collapses to `null`, deliberately.** `GET /digests/quota` is
 * not in the router yet (see `getDigestQuota`), so the common answer on a
 * frontend deployed ahead of the API is a 404 — and a 404 here is not news for
 * the reader, it is an endpoint that has not shipped. A 403 is the same shape
 * of non-news for a `reports:view`-only role. Neither may put an error card on
 * a screen whose actual subject loaded fine, and neither may render "0 of 0
 * left today", which reads as a *spent* allowance rather than an unknown one.
 *
 * `retry: false` for the reason the 4xx default already gives — the server's
 * answer will not change — and because retrying a route that does not exist
 * three times per page load is noise in the network tab and in the API's logs.
 */
export function useDigestQuota(): DigestQuota | null {
  const query = useQuery<DigestQuota, ApiError>({
    queryKey: digestKeys.quota(),
    queryFn: getDigestQuota,
    retry: false,
    staleTime: 60_000,
  });
  return query.data ?? null;
}

export function useRunDigest(): UseMutationResult<
  RunDigestResult,
  ApiError,
  void
> {
  const queryClient = useQueryClient();
  return useMutation<RunDigestResult, ApiError, void>({
    mutationFn: () => runDigest(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: digestKeys.all });
    },
  });
}
