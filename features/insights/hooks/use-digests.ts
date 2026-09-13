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
  getLatestDigest,
  listDigests,
  runDigest,
} from "@/features/insights/services/digest.service";
import type {
  Digest,
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
