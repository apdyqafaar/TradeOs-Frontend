"use client";

import { UserX } from "lucide-react";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useSession } from "@/features/auth/hooks/use-session";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { MemberRowActions } from "@/features/team/components/member-row-actions";
import { useMember } from "@/features/team/hooks/use-member";
import {
  isOwnerMember,
  memberInitials,
  memberPrimaryLabel,
  memberSecondaryLabel,
} from "@/features/team/lib/member-rules";
import type { ListedMember } from "@/features/team/types";
import { API_ERROR_CODE, type ApiError, hasCode } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { formatDate } from "@/lib/format/date";

/**
 * One field of the record: a quiet label above the thing it names.
 *
 * A definition list rather than a table — this is one subject with several
 * attributes, which is what `<dl>` is for, and it reads correctly to a screen
 * reader without inventing column headers that are not on screen.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </dt>
      <dd className="text-[14px] text-foreground">{children}</dd>
    </div>
  );
}

/**
 * One member's record.
 *
 * **What this screen is not.** It does not show what the member has sold — the
 * Staff report already answers that for everybody at once, and per-member
 * sales are not fetchable from any member endpoint (`docs/contracts/team.md`).
 * It does not show who invited them: `invitedBy` is stored on every invite
 * path but no mapper emits it and no populate fetches it, so it is not
 * renderable at any price. And it does not show when a pending invitation
 * lapses — the 7-day TTL lives on a `Verification` document the API never
 * returns. All three were checked, and each absence is the API's, not a gap
 * here (`docs/findings/slice5-team.md` §2).
 *
 * What it is: the identity, the role, the standing, and the two actions that
 * belong to one person rather than to a list — change their role, remove them.
 * Both are the same controls the table row carries, so the two can never
 * disagree about what is allowed.
 */
export function MemberDetail({ memberId }: { memberId: ObjectId }) {
  const { data: member, isPending, error, refetch } = useMember(memberId);
  const { timezone } = useOrganization();

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-52 rounded-[8px]" />
        <Skeleton className="h-[220px] rounded-[12px]" />
      </div>
    );
  }

  // A removed member and an id that never existed are the same 404, and the
  // same sentence: there is no former-staff view anywhere in this product, so
  // "not found" would leave a reader who just removed someone wondering
  // whether it worked.
  if (error && hasCode(error as ApiError, API_ERROR_CODE.NOT_FOUND)) {
    return (
      <EmptyState
        icon={UserX}
        title="This member is not on your team"
        description="They may have been removed, or the link may point at another business. Removed members are not kept on the list."
        action={
          <ButtonLink variant="outline" href={ROUTES.team}>
            Back to members
          </ButtonLink>
        }
      />
    );
  }

  if (error) {
    return <ErrorCard error={error as ApiError} retry={() => void refetch()} />;
  }

  return <MemberRecord member={member} timezone={timezone} />;
}

function MemberRecord({
  member,
  timezone,
}: {
  member: ListedMember;
  timezone: string;
}) {
  // The signed-in USER's id, not a member id: `canRemoveMember` uses it to
  // stop someone removing themselves, and the two id spaces are different
  // rows entirely (`member-rules.ts`, `isSelfMember`).
  const session = useSession();
  const name = memberPrimaryLabel(member);
  const email = memberSecondaryLabel(member);
  const pending = member.status !== "active";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 flex-none items-center justify-center rounded-full bg-muted font-medium text-[16px] text-muted-foreground"
          >
            {memberInitials(member)}
          </span>

          <div className="flex flex-col gap-1">
            <h1 className="font-serif text-3xl text-foreground leading-tight">
              {name}
            </h1>
            {email ? (
              <p className="font-mono text-[13px] text-muted-foreground">
                {email}
              </p>
            ) : null}
          </div>
        </div>

        {/* The same controls the table row carries, so the two can never
            disagree about who may be re-roled or removed. It hides itself
            entirely when neither action is permitted. */}
        <MemberRowActions
          member={member}
          sessionUserId={session.data?.user.id}
        />
      </header>

      {pending ? (
        <p className="rounded-[10px] border border-border bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          This invitation has not been accepted yet. They cannot sign in until
          they set a password from the link in their email — resend it from the
          actions above if it went astray.
        </p>
      ) : null}

      <dl className="grid gap-5 rounded-[12px] border border-border bg-card px-5 py-5 sm:grid-cols-2">
        <Field label="Role">
          {member.role ? (
            <span className="flex flex-wrap items-center gap-2">
              {member.role.name}
              {isOwnerMember(member) ? (
                <span className="text-[13px] text-muted-foreground">
                  · fixed for the life of the business
                </span>
              ) : null}
            </span>
          ) : (
            // `role: null` only if the role document vanished — near
            // unreachable, and rendering for it beats rendering "undefined".
            <span className="text-muted-foreground">No role</span>
          )}
        </Field>

        <Field label="Status">
          {member.status === "active" ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="outline">Pending</Badge>
          )}
        </Field>

        <Field label={member.joinedAt ? "Joined" : "Invited"}>
          <span className="font-mono text-[13px]">
            {/* `joinedAt` is absent until they accept, so a pending row shows
                the date the membership was created instead — the only date it
                has, and the closest honest proxy. */}
            {formatDate(member.joinedAt ?? member.createdAt, timezone)}
          </span>
        </Field>

        <Field label="Email">
          <span className="font-mono text-[13px]">
            {member.user?.email ?? member.invitedEmail ?? "—"}
          </span>
        </Field>
      </dl>
    </div>
  );
}
