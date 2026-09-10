"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/hooks/use-session";
import { organizationKeys } from "@/features/organization/keys";
import { getCurrentOrganization } from "@/features/organization/services/organization.service";
import type { Organization } from "@/features/organization/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * `GET /organizations/current` — the full business profile.
 *
 * Separate from `useSession`, which already carries `{ id, name, slug,
 * timezone }`, because the Settings form also edits `phone` and `address` and
 * renders `logo`, and none of those three is on the session shape
 * (`auth.controller.ts:94-107`). Reading the session's four fields and leaving
 * the other three blank would look like a business with no phone number rather
 * than a screen that never asked for one.
 *
 * Disabled without an organization: the route is gated on `organization:view`
 * behind `requireMember`, so a member-less caller gets "You do not belong to a
 * business yet" rather than a profile. `/settings` is server-gated on
 * `organization:update` and the app shell already redirects a member-less user
 * to onboarding, so this is belt and braces — but `/account` renders for a
 * member-less user by design, and any shared component that reaches for this
 * must not fire a doomed request there.
 *
 * `staleTime` is short. Unlike the currency, this is the screen's own subject:
 * a stale name here is a form that quietly reverts what someone just typed.
 */
export function useOrganizationProfile(): UseQueryResult<
  Organization,
  ApiError
> {
  const session = useSession();

  return useQuery<Organization, ApiError>({
    queryKey: organizationKeys.current(),
    queryFn: getCurrentOrganization,
    enabled: session.data?.organization != null,
    staleTime: 60_000,
  });
}
