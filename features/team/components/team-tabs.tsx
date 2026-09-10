"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The two-tab strip at the top of the team screens — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1216-1219`).
 *
 * **Links, not tab panels.** The design draws them as tabs, but Members and
 * Roles are two routes with two different page permissions
 * (`/team` on `members:invite`, `/team/roles` on `roles:view`, both set in
 * `config/routes.ts`), and each is server-gated before it renders. Making them
 * ARIA tabs would mean one route holding both panels and a client-side gate
 * deciding which to show — the thing `app/(app)/layout.tsx` exists to stop.
 * So this is `role="navigation"` styled as a tab strip, and `aria-current`
 * carries the selected state that `aria-selected` would have.
 *
 * **The Roles tab is hidden from anyone without `roles:view`.** Hidden, not
 * disabled (CLAUDE.md): a Manager holds it, a Seller does not, and a custom
 * role may not. A disabled tab would advertise a screen the person cannot open
 * and cannot ask for by name. The Members tab is never hidden — reaching this
 * component at all means the server already cleared `/team`.
 *
 * The count beside Members is `meta.total` from the members list, and it counts
 * **active plus invited**, which is exactly what the list shows. Removed
 * members are excluded from both, so the number and the rows can never
 * disagree. It is optional because the roles screen has no members query of its
 * own and a number that appeared only on one tab would look like a bug.
 */
export interface TeamTabsProps {
  /** `meta.total` from `GET /members`, when the screen has it. */
  memberCount?: number;
  className?: string;
}

export function TeamTabs({ memberCount, className }: TeamTabsProps) {
  const pathname = usePathname();
  const canViewRoles = useCan(PERMISSIONS.ROLES_VIEW);

  const onRoles = pathname.startsWith(ROUTES.teamRoles);

  return (
    <nav
      aria-label="Team sections"
      className={cn("flex gap-6 border-b border-border", className)}
    >
      <TeamTab href={ROUTES.team} active={!onRoles}>
        Members
        {memberCount === undefined ? null : (
          <span className="font-mono text-[11px] text-muted-foreground">
            {memberCount}
          </span>
        )}
      </TeamTab>

      {canViewRoles ? (
        <TeamTab href={ROUTES.teamRoles} active={onRoles}>
          Roles
        </TeamTab>
      ) : null}
    </nav>
  );
}

function TeamTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
