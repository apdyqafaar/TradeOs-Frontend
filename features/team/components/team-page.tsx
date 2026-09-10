"use client";

import { UsersRound } from "lucide-react";
import { parseAsInteger, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useSession } from "@/features/auth/hooks/use-session";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useMembers } from "../hooks/use-members";
import { useRoles } from "../hooks/use-roles";
import { assignableRoles } from "../services/role.service";
import { InviteMemberDialog } from "./invite-member-dialog";
import { MemberTable } from "./member-table";
import { TeamTabs } from "./team-tabs";

/**
 * The members screen — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1212-1247`).
 *
 * ## Two query keys in the URL, and no third
 *
 * `page` and `limit`, because that is the entire query schema for
 * `GET /members` and it is `.strict()`: a `?search=` or `?status=` would be a
 * **422**, not an ignored parameter. So there is no search box and no status
 * filter on this screen — not as a simplification, but because the endpoint has
 * neither and a client-side filter over one page of N would lie about the rest.
 *
 * ## Five list states, and why the sixth is elsewhere
 *
 * Loading, empty, error-with-request-id and 403 all land here. **There is no
 * filtered-empty state**, because there is no filter to be empty under — the
 * only way this list is empty is if the caller is not on it, which cannot
 * happen. The domain-409 state belongs to the controls that raise them: the
 * invite dialog and the row menu.
 *
 * ## The roles query is allowed to fail
 *
 * `GET /roles` is gated on `roles:view`, which this page is **not**. A custom
 * role holding `members:invite` without `roles:view` can legitimately stand
 * here: they get the members table, and the role picker degrades to plain text
 * because there is nothing to pick from. That is why `assignable` falls back to
 * `[]` rather than blocking the screen on a query it does not strictly need.
 */
const PAGINATION_PARSERS = {
  page: parseAsInteger.withDefault(1),
  // 25 rather than the API's default of 20: the table's own row-count selector
  // offers 25/50/100, and a default outside its options renders a select with
  // no selected option. The API caps `limit` at 100 and 422s above it, so every
  // option is legal.
  limit: parseAsInteger.withDefault(25),
};

export function TeamPage() {
  const [pagination, setPagination] = useQueryStates(PAGINATION_PARSERS, {
    history: "replace",
    scroll: false,
  });

  const canInvite = useCan(PERMISSIONS.MEMBERS_INVITE);
  const canUpdate = useCan(PERMISSIONS.MEMBERS_UPDATE);
  const canViewRoles = useCan(PERMISSIONS.ROLES_VIEW);

  const session = useSession();
  const { timezone } = useOrganization();

  const [inviting, setInviting] = useState(false);

  const members = useMembers(pagination);
  // Not fetched at all without the permission — a guaranteed 403 costs a
  // request and puts a red herring in the network tab.
  const roles = useRoles({ enabled: canViewRoles });
  const assignable = assignableRoles(roles.data ?? []);

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. The page is already server-gated on `members:invite`, so
  // arriving here with a 403 from `members:view` means a custom role lost it
  // between the gate and the fetch.
  if (members.error?.status === 403) {
    return <ForbiddenScreen />;
  }

  const meta = members.data?.meta;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
          Members
        </h1>

        {/* Hidden, never disabled. The page is gated on `members:invite`, so in
            practice everybody here holds it — but the gate and the control
            should agree by construction rather than by coincidence. */}
        {canInvite ? (
          <Button onClick={() => setInviting(true)}>Invite</Button>
        ) : null}
      </div>

      <TeamTabs memberCount={meta?.total} />

      {members.error ? (
        <ErrorCard
          error={members.error}
          retry={() => void members.refetch()}
          title="Couldn't load the team"
        />
      ) : (
        <MemberTable
          rows={members.data?.items ?? []}
          meta={
            meta ?? {
              page: 1,
              limit: pagination.limit,
              total: 0,
              totalPages: 1,
            }
          }
          assignableRoles={assignable}
          canUpdateRole={canUpdate}
          sessionUserId={session.data?.user.id}
          timezone={timezone}
          isLoading={members.isPending}
          isStale={members.isPlaceholderData}
          emptyState={
            <EmptyState
              title="Nobody here yet"
              description="Invite the people who work with you and they will appear on this list once they accept."
              icon={UsersRound}
              action={
                canInvite ? (
                  <Button size="sm" onClick={() => setInviting(true)}>
                    Invite a teammate
                  </Button>
                ) : undefined
              }
            />
          }
          onPageChange={(page) => void setPagination({ page })}
          onLimitChange={(limit) => void setPagination({ limit, page: 1 })}
        />
      )}

      {canInvite ? (
        <InviteMemberDialog
          open={inviting}
          onOpenChange={setInviting}
          roles={assignable}
          rolesLoading={canViewRoles && roles.isPending}
        />
      ) : null}
    </div>
  );
}
