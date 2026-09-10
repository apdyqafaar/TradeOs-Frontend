"use client";

import { cn } from "cn";
import { Check } from "lucide-react";
import { useId } from "react";
import type { Permission } from "@/lib/auth/permissions";
import {
  PERMISSION_GROUPS,
  type PermissionGroup,
  STANDARD_ACTIONS,
  type StandardAction,
} from "../lib/permission-catalog";

/**
 * The permission matrix — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1289-1319`): a resource per row, then View,
 * Create, Update, Delete and Special.
 *
 * ## Three cell states, not two
 *
 * A cell is granted, ungranted, or **not a permission at all**. The third is
 * the one people forget: `payments` has no `view`, `uploads` has neither `view`
 * nor `delete`, `reports` has only `view`. Rendering those as unticked boxes
 * would promise a permission that does not exist and cannot be granted, so they
 * are drawn as a muted rule with an `sr-only` explanation rather than a control.
 *
 * ## Read-only is the common case
 *
 * Three of the roles in any business are presets, and PATCHing one is a **403
 * `"Built-in roles cannot be changed"`**. The design's own note says presets
 * "open the same matrix read-only", which is exactly right: seeing what a
 * Seller can do is the reason most people open this screen at all. In that mode
 * the boxes become static marks with no focus stop, so nobody tabs through 43
 * controls that cannot move.
 *
 * ## The Owner preset never gets here
 *
 * Its permissions array is the single wildcard `["*"]`, which is not a set of
 * boxes and is deliberately open-ended — it covers permissions the backend has
 * not shipped yet. `RoleDetail` renders a sentence for it instead of a grid.
 */
export interface PermissionMatrixProps {
  /** The permissions currently granted. A `Set` because every cell asks it once. */
  value: ReadonlySet<string>;
  /**
   * Omit to render read-only. Called with the full next set, already a new
   * object — never a mutation of `value`.
   */
  onChange?: (next: Set<string>) => void;
  className?: string;
}

export function PermissionMatrix({
  value,
  onChange,
  className,
}: PermissionMatrixProps) {
  const readOnly = !onChange;

  const toggle = (permission: Permission, granted: boolean) => {
    if (!onChange) return;
    const next = new Set(value);
    // A `Set`, so a double-click cannot produce the duplicate entry the backend
    // would accept and then count against the 43-item cap.
    if (granted) next.add(permission);
    else next.delete(permission);
    onChange(next);
  };

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[10px] border border-border bg-card",
        className,
      )}
    >
      <table className="w-full min-w-[520px] border-collapse text-left">
        <caption className="sr-only">
          What this role can do, by area of the product
        </caption>
        <thead>
          <tr className="bg-muted/60">
            <th
              scope="col"
              className="border-b border-border px-3.5 py-2.5 font-mono text-[10px] font-normal tracking-[0.08em] text-muted-foreground uppercase"
            >
              Resource
            </th>
            {STANDARD_ACTIONS.map((action) => (
              <th
                key={action}
                scope="col"
                className="border-b border-border px-2 py-2.5 text-center font-mono text-[10px] font-normal tracking-[0.06em] text-muted-foreground uppercase"
              >
                {action}
              </th>
            ))}
            <th
              scope="col"
              className="border-b border-border px-2 py-2.5 text-center font-mono text-[10px] font-normal tracking-[0.06em] text-muted-foreground uppercase"
            >
              Special
            </th>
          </tr>
        </thead>

        <tbody>
          {PERMISSION_GROUPS.map((group) => (
            <MatrixRow
              key={group.resource}
              group={group}
              value={value}
              readOnly={readOnly}
              onToggle={toggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixRow({
  group,
  value,
  readOnly,
  onToggle,
}: {
  group: PermissionGroup;
  value: ReadonlySet<string>;
  readOnly: boolean;
  onToggle: (permission: Permission, granted: boolean) => void;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <th
        scope="row"
        className="px-3.5 py-2 text-left font-mono text-xs font-normal text-foreground"
      >
        {group.resource}
      </th>

      {STANDARD_ACTIONS.map((action: StandardAction) => {
        const permission = group.standard[action];
        return (
          <td key={action} className="px-2 py-2 text-center">
            {permission ? (
              <PermissionCell
                permission={permission}
                label={`${action} ${group.resource}`}
                granted={value.has(permission)}
                readOnly={readOnly}
                onToggle={onToggle}
              />
            ) : (
              <NotApplicable action={action} resource={group.resource} />
            )}
          </td>
        );
      })}

      <td className="px-2 py-2">
        {group.specials.length === 0 ? (
          <div className="flex justify-center">
            <NotApplicable action="special" resource={group.resource} />
          </div>
        ) : (
          // `members` holds two specials — invite and remove — which is the one
          // place the design's single 18px cell had to grow. The label rides
          // beside the box rather than being a title attribute, because a
          // keyboard or screen-reader user cannot hover a tooltip.
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {group.specials.map((special) => (
              <div
                key={special.permission}
                className="flex items-center gap-1.5"
              >
                <PermissionCell
                  permission={special.permission}
                  // Lower-cased so the read-only cell's sentence reads
                  // "Cannot adjust stock products" rather than
                  // "Cannot Adjust stock products". The visible chip beside it
                  // keeps the sentence-case label.
                  label={`${special.label.toLowerCase()} ${group.resource}`}
                  granted={value.has(special.permission)}
                  readOnly={readOnly}
                  onToggle={onToggle}
                />
                {group.specials.length > 1 ? (
                  <span className="text-[10px] text-muted-foreground">
                    {special.label}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

const BOX =
  "flex size-[18px] items-center justify-center rounded-[5px] border transition-colors";

function PermissionCell({
  permission,
  label,
  granted,
  readOnly,
  onToggle,
}: {
  permission: Permission;
  label: string;
  granted: boolean;
  readOnly: boolean;
  onToggle: (permission: Permission, granted: boolean) => void;
}) {
  const uid = useId();

  if (readOnly) {
    return (
      <span
        className={cn(
          BOX,
          "mx-auto",
          granted
            ? "border-primary/40 bg-primary/15"
            : "border-border bg-background",
        )}
      >
        {granted ? (
          <Check className="size-3 text-primary" aria-hidden="true" />
        ) : null}
        <span className="sr-only">
          {granted ? `Can ${label}` : `Cannot ${label}`}
        </span>
      </span>
    );
  }

  return (
    <label
      htmlFor={uid}
      className="mx-auto flex w-fit cursor-pointer items-center justify-center"
    >
      <input
        id={uid}
        type="checkbox"
        checked={granted}
        onChange={(event) => onToggle(permission, event.target.checked)}
        className="peer sr-only"
      />
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          BOX,
          "border-border bg-background peer-checked:border-primary/40 peer-checked:bg-primary/15 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
        )}
      >
        <Check
          className={cn(
            "size-3 text-primary",
            granted ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </label>
  );
}

/**
 * A cell for an action this resource does not have.
 *
 * A rule, not an empty box: an unticked box reads as "not granted yet", which
 * would be a promise that ticking it is possible. `uploads:create` covers
 * listing and deleting an upload, and no amount of clicking will produce an
 * `uploads:delete` the catalog does not contain.
 */
function NotApplicable({
  action,
  resource,
}: {
  action: string;
  resource: string;
}) {
  return (
    <span className="inline-flex items-center justify-center">
      <span aria-hidden="true" className="h-px w-2.5 bg-border-strong" />
      <span className="sr-only">
        There is no {action} permission for {resource}
      </span>
    </span>
  );
}
