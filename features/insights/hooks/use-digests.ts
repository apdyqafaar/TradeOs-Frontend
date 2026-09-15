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
  RunDigestInput,
  RunDigestResult,
} from "@/features/insights/types";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
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
 * **Every failure collapses to `null`, deliberately.** A 403 is what a role
 * holding `reports:view` through a stale session gets, and an older API build
 * answers 404 for a route it does not have. Neither is news the reader can act
 * on, neither may put an error card on a screen whose actual subject loaded
 * fine, and — most importantly — neither may render **"0 of 0 left today"**,
 * which reads as a *spent* allowance rather than an unknown one and would tell
 * an owner with two runs in hand that they had none.
 *
 * `retry: false` for the reason the 4xx default already gives: the server's
 * answer will not change.
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

/**
 * Asks for a run over one period, and keeps the allowance on screen honest
 * **from the answer itself** rather than from a second request.
 *
 * Both outcomes carry the new quota: the 202 carries `quota`, and the 429
 * refusal carries the same four fields in `details` under
 * `DIGEST_QUOTA_EXHAUSTED`. Writing both into the quota cache means the header
 * is right the instant the button answers, on the mobile connections this
 * market actually runs on, with no refetch to wait for.
 *
 * **No optimistic decrement, and no restore dance.** A successful request
 * spends the run even if the dispatch then fails, and the backend does not
 * refund it (`digest.service.ts:113-125` argues why: a run charged and not
 * delivered is a support question, a run delivered twice for free is a bill).
 * Guessing at the number locally and correcting it afterwards would invent a
 * state the server never holds.
 *
 * `latest` and the lists are invalidated; the quota key deliberately is not,
 * because the value just written IS the server's answer and refetching it
 * would replace a fact with the same fact one round trip later.
 */
export function useRunDigest(): UseMutationResult<
  RunDigestResult,
  ApiError,
  RunDigestInput
> {
  const queryClient = useQueryClient();
  return useMutation<RunDigestResult, ApiError, RunDigestInput>({
    mutationFn: (input) => runDigest(input),
    onSuccess: (result) => {
      queryClient.setQueryData(digestKeys.quota(), result.quota);
      void queryClient.invalidateQueries({ queryKey: digestKeys.latest() });
      void queryClient.invalidateQueries({ queryKey: digestKeys.lists });
    },
    onError: (error) => {
      const quota = quotaFromRefusal(error);
      if (quota) queryClient.setQueryData(digestKeys.quota(), quota);
    },
  });
}

/**
 * The allowance carried by a `DIGEST_QUOTA_EXHAUSTED` refusal, or `null`.
 *
 * **Branches on the code, never on the bare 429.** The same route also answers
 * 429 `TOO_MANY_REQUESTS` from the loop-shield limiter, which means "you are
 * calling this too fast" and carries no quota at all; reading `details` off
 * that one would put whatever it happened to hold into the header. The backend
 * gave the two different codes precisely so a client cannot conflate them.
 *
 * Exported so the button can render the refusal's own numbers in its message
 * without re-deriving them.
 */
export function quotaFromRefusal(error: ApiError | null): DigestQuota | null {
  if (!error || error.code !== API_ERROR_CODE.DIGEST_QUOTA_EXHAUSTED) {
    return null;
  }
  const details = error.details;
  if (!details) return null;
  const { limit, used, remaining, resetsAt } = details;
  if (
    typeof limit !== "number" ||
    typeof used !== "number" ||
    typeof remaining !== "number" ||
    typeof resetsAt !== "string"
  ) {
    return null;
  }
  return { limit, used, remaining, resetsAt };
}
