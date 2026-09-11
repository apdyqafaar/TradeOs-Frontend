"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import type { ObjectId, PageMeta } from "@/lib/api/types";
import { formatDate } from "@/lib/format/date";
import {
  isSelfMember,
  memberInitials,
  memberPrimaryLabel,
  memberSecondaryLabel,
} from "../lib/member-rules";
import type { ListedMember, Role } from "../types";
import { MemberRoleCell } from "./member-role-cell";
import { MemberRowActions } from "./member-row-actions";

/**
 * The members table — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1220-1247`): member, role, status, joined,
 * and a row menu.
 *
 * ## What the design asks for and the API cannot give
 *
 * The artboard's columns are all satisfiable. Two things a members screen
 * normally carries are **not**, and neither is a matter of effort:
 *
 *   - **"Invited by"** — stored on every invite, but no mapper emits it and no
 *     populate fetches it. It is absent from both member shapes and from the
 *     query that builds the list. Not renderable at any price
 *     (`docs/contracts/team.md` T2).
 *   - **When an invitation expires** — the 7-day TTL lives on a `Verification`
 *     document the API never returns, and no member field carries it. So a
 *     pending row can say when it was sent, never when it lapses.
 *
 * Neither has a column, because a column that is always empty teaches people to
 * stop reading the table.
 *
 * ## No sorting, no search, no removed members
 *
 * `GET /members` takes `page` and `limit` and nothing else, under a `.strict()`
 * schema — a `?search=` would be a **422**, not an ignored parameter. The order
 * is fixed at oldest-first (`{ createdAt: 1, _id: 1 }`), which is why the owner
 * is normally row 1 and why no column here is `sortable`. Sorting the visible
 * page client-side would reorder 20 rows and lie about the other 200.
 *
 * Removed members are filtered out server-side with no override, so this table
 * is always "who is on the team now" and there is no former-staff view to
 * build.
 */
export interface MemberTableProps {
  rows: ListedMember[];
  meta: PageMeta;
  /** Roles this caller may assign — Owner already filtered out. `[]` when unavailable. */
  assignableRoles: Role[];
  /** `members:update`. Decides whether the Role cell is a control or text. */
  canUpdateRole: boolean;
  /** The signed-in user's id (`user.id`), for the "You" marker and the self guards. */
  sessionUserId: ObjectId | undefined;
  /** The business's IANA zone. Every date on this screen is the business's day. */
  timezone: string;
  isLoading: boolean;
  isStale: boolean;
  emptyState: ReactNode;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function MemberTable({
  rows,
  meta,
  assignableRoles,
  canUpdateRole,
  sessionUserId,
  timezone,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: MemberTableProps) {
  const columns: DataTableColumn<ListedMember>[] = [
    {
      key: "member",
      header: "Member",
      cell: (member) => {
        const primary = memberPrimaryLabel(member);
        const secondary = memberSecondaryLabel(member);

        return (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-8 flex-none">
              {/* `image` is an omitted key when the user never set one, so this
                  renders nothing rather than a broken image. */}
              {member.user?.image ? (
                <AvatarImage src={member.user.image} alt="" />
              ) : null}
              <AvatarFallback className="font-mono text-[11px]">
                {memberInitials(member)}
              </AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 truncate font-medium text-[13px] text-foreground">
                {/* The name is the link, not the whole row: the row already
                    holds a role select and an actions menu, and a row-level
                    click target would fight both of them. */}
                <Link
                  href={ROUTES.teamMember(member.id)}
                  className="truncate rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {primary}
                </Link>
                {isSelfMember(member, sessionUserId) ? (
                  // Matched on `user.id`: `GET /auth/me` does not return the
                  // caller's own member id, so there is no member-level
                  // identity to compare against.
                  <span className="font-normal text-[11px] text-muted-foreground">
                    (You)
                  </span>
                ) : null}
              </span>
              {secondary ? (
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {secondary}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      className: "w-[180px]",
      cell: (member) => (
        <MemberRoleCell
          member={member}
          roles={assignableRoles}
          canUpdate={canUpdateRole}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-[120px]",
      cell: (member) =>
        member.status === "active" ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          // "Pending", not "Invited": the row's own word for itself is what the
          // person reading wants — is this someone I can rely on today, or
          // someone I am still waiting on?
          <Badge variant="outline">Pending</Badge>
        ),
    },
    {
      key: "joined",
      header: "Joined",
      align: "end",
      hideBelowMd: true,
      className: "w-[150px]",
      cell: (member) =>
        member.joinedAt ? (
          <span className="font-mono text-xs text-muted-foreground">
            {formatDate(member.joinedAt, timezone)}
          </span>
        ) : (
          // A pending row has no `joinedAt` key at all. `createdAt` is when the
          // invitation was sent, which is the only date this row has and is
          // worth more than a dash — a three-week-old invitation is a fact the
          // owner should be able to see, and it is the closest this API gets to
          // an expiry, which it does not expose.
          <span className="font-mono text-xs text-muted-foreground">
            Invited {formatDate(member.createdAt, timezone)}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      className: "w-[52px]",
      cell: (member) => (
        <MemberRowActions member={member} sessionUserId={sessionUserId} />
      ),
    },
  ];

  return (
    <DataTable
      caption="Members of this business, oldest first"
      columns={columns}
      rows={rows}
      getRowId={(member) => member.id}
      isLoading={isLoading}
      isStale={isStale}
      emptyState={emptyState}
      pagination={{ ...meta, onPageChange, onLimitChange }}
    />
  );
}
