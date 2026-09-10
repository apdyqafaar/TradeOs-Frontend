"use client";

import { cn } from "cn";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { PERMISSIONS, WILDCARD } from "@/lib/auth/permissions";
import { useRoleMemberCounts } from "../hooks/use-role-member-counts";
import { useRoles } from "../hooks/use-roles";
import type { Role } from "../types";
import { DeleteRoleDialog } from "./delete-role-dialog";
import { PermissionMatrix } from "./permission-matrix";
import { RoleDialog } from "./role-dialog";
import { roleSummary } from "./role-summary";
import { TeamTabs } from "./team-tabs";

/**
 * The roles screen — the lower panel of artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1250-1266`) plus the matrix card beside it
 * (`:1289-1319`).
 *
 * The two are joined here rather than kept as a list and a side panel, because
 * the matrix is *about* one row and a list of four roles does not earn a
 * split-pane. Opening a row expands its matrix underneath it, read-only —
 * which the design's own note anticipates: "Preset roles open the same matrix
 * read-only."
 *
 * ## What the API gives, and the one number it does not
 *
 * `GET /roles` answers name, description, permissions, `isCustom` and
 * `isPreset` — and **no member count**. The "4" the design draws beside each
 * role is derived from the members list (`useRoleMemberCounts`), which counts
 * with exactly the predicate the delete guard uses, so the number next to a
 * role and the 409 that refuses its deletion can never disagree.
 *
 * That derivation costs a second query, and it needs `members:view` — which
 * every preset holds, Seller included. A custom role with `roles:view` but not
 * `members:view` sees the roles and no counts; the count is simply omitted
 * rather than shown as a confident `0`.
 *
 * ## Presets are read-only, and this is enforced three ways
 *
 * Editing or deleting one is a **403 `"Built-in roles cannot be changed"`**.
 * The Edit and Delete controls are not rendered for them, `isPreset` is read
 * off the wire rather than inferred from the name, and the matrix opens without
 * an `onChange`. Owner is a further special case: its permissions array is the
 * single wildcard `["*"]`, which is not a set of boxes at all.
 */
export function RolesPage() {
  const canCreate = useCan(PERMISSIONS.ROLES_CREATE);
  const canUpdate = useCan(PERMISSIONS.ROLES_UPDATE);
  const canDelete = useCan(PERMISSIONS.ROLES_DELETE);
  const canViewMembers = useCan(PERMISSIONS.MEMBERS_VIEW);

  const roles = useRoles();
  const counts = useRoleMemberCounts();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  if (roles.error?.status === 403) {
    return <ForbiddenScreen />;
  }

  // `countFor` answers 0 both for "nobody holds this" and for "the directory
  // never loaded", so the caller has to disambiguate before rendering a number.
  // A confident 0 next to a Delete button that then 409s is exactly the bug
  // this guard exists to prevent.
  const countsKnown = canViewMembers && !counts.isError && !counts.isLoading;
  const countFor = (role: Role): number | undefined =>
    countsKnown ? counts.countFor(role.id) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
          Roles
        </h1>

        {canCreate ? (
          <Button onClick={() => setCreating(true)}>New role</Button>
        ) : null}
      </div>

      <TeamTabs />

      {roles.error ? (
        <ErrorCard
          error={roles.error}
          retry={() => void roles.refetch()}
          title="Couldn't load the roles"
        />
      ) : roles.isPending ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-6 w-36" />
        </div>
      ) : roles.data.length === 0 ? (
        // Unreachable in practice — the three presets are seeded from code at
        // every server boot and belong to every business — but a list component
        // that cannot render empty is one server change away from a blank page.
        <EmptyState
          title="No roles"
          description="The built-in roles should always be here. If this list is empty, something is wrong on the server."
          icon={ShieldCheck}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-card">
          {roles.data.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              memberCount={countFor(role)}
              expanded={expanded === role.id}
              onToggle={() =>
                setExpanded((current) => (current === role.id ? null : role.id))
              }
              canEdit={canUpdate && role.isCustom}
              canDelete={canDelete && role.isCustom}
              onEdit={() => setEditing(role)}
              onDelete={() => setDeleting(role)}
            />
          ))}
        </ul>
      )}

      {canCreate ? (
        <RoleDialog open={creating} onOpenChange={setCreating} />
      ) : null}

      {editing ? (
        <RoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          role={editing}
        />
      ) : null}

      {deleting ? (
        <DeleteRoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          role={deleting}
          memberCount={countFor(deleting)}
        />
      ) : null}
    </div>
  );
}

function RoleRow({
  role,
  memberCount,
  expanded,
  onToggle,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  role: Role;
  memberCount: number | undefined;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const panelId = `role-permissions-${role.id}`;
  // `["*"]` is not a grid. It is one entry that means "everything, including
  // permissions this build has never heard of", and drawing 43 ticked boxes for
  // it would understate it the moment the backend ships a 44th.
  const isWildcard = role.permissions.includes(WILDCARD);

  return (
    <li>
      <div className="flex items-center gap-3.5 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 flex-none text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-[13px] text-foreground">
              {role.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {roleSummary(role)}
            </span>
          </span>
        </button>

        {memberCount === undefined ? null : (
          <span className="font-mono text-[11px] text-muted-foreground">
            {memberCount === 1 ? "1 member" : `${memberCount} members`}
          </span>
        )}

        {/* Read off the wire, not inferred from the name: `isPreset` is
            `organizationId === null`, which is the same fact the 403 guard
            uses. */}
        {role.isPreset ? <Badge variant="outline">Preset</Badge> : null}

        {canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
        {canDelete ? (
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div id={panelId} className="px-4 pb-4">
          {isWildcard ? (
            <p className="rounded-[10px] border border-info/30 bg-info-soft px-3.5 py-2.5 text-[13px] text-info-strong">
              The owner can do everything, including anything TradeOs adds
              later. There is no list to show — and this role cannot be given to
              anyone else, so every business has exactly one owner.
            </p>
          ) : (
            <PermissionMatrix value={new Set(role.permissions)} />
          )}
        </div>
      ) : null}
    </li>
  );
}
