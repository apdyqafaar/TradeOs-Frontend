import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * The permission matrix's data, **derived** from `lib/auth/permissions.ts`
 * rather than transcribed.
 *
 * `lib/auth/permissions.ts` is the repo's declared mirror of
 * `Backend/src/lib/permissions.ts`, and `docs/contracts/team.md` §11 verified
 * the two are identical today — same 43 entries, same names, same values, same
 * order. Deriving the grid from that array instead of hand-writing 43 rows
 * means the next permission the backend adds shows up in this matrix the moment
 * somebody updates the mirror, with no second list to forget.
 *
 * ## The grid the design asks for, and where it does not fit
 *
 * Artboard `2j` (`docs/design/TradeOs-UI.dc.html:1290-1310`) draws six columns:
 * a resource name and then View / Create / Update / Delete / Special, with the
 * note "Specials cover adjust stock, void, write off, invite, remove and
 * publish."
 *
 * Four of the five action columns are exact. The **Special** column is not one
 * permission per row: `members` holds **two** specials (`members:invite` and
 * `members:remove`), and the drawn cell has room for one 18px box. Rather than
 * drop a permission or add a column that would be blank on twelve of thirteen
 * rows, the Special cell renders one control per special permission in that
 * group, each labelled. `members` is the only row where more than one appears.
 *
 * Rows are sparse on purpose. `reports` holds only `view`, `uploads` only
 * `create`, and `payments` has no `view` at all — `uploads:create` covers
 * listing and deletion too (`permissions.ts:66-70`). A blank cell means the
 * permission does not exist, which is a different fact from "not granted", and
 * the matrix component renders the two differently.
 */

/** The four columns that are the same action on every resource that has them. */
export const STANDARD_ACTIONS = ["view", "create", "update", "delete"] as const;

export type StandardAction = (typeof STANDARD_ACTIONS)[number];

const STANDARD = new Set<string>(STANDARD_ACTIONS);

/** One special permission: an action outside the four standard columns. */
export interface SpecialPermission {
  permission: Permission;
  /** `adjust_stock` becomes `Adjust stock`. Sentence case, for a checkbox label. */
  label: string;
}

/** One row of the matrix: a resource group and the permissions it owns. */
export interface PermissionGroup {
  /** The wire prefix — `products`, `members`. Rendered in mono per the design. */
  resource: string;
  /** `Products`, `Members`. Capitalised prefix; the wire name stays the id. */
  label: string;
  /**
   * The standard columns this resource actually has. A missing key is a
   * permission that does not exist, not one that is merely ungranted.
   */
  standard: Partial<Record<StandardAction, Permission>>;
  /** Everything else this resource owns, in catalog order. Usually 0 or 1. */
  specials: SpecialPermission[];
  /** Every permission in the group, standard and special, in catalog order. */
  all: Permission[];
}

/** `adjust_stock` becomes `Adjust stock`; `void` becomes `Void`. */
const humanise = (action: string): string => {
  const words = action.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Group order is **first appearance in `ALL_PERMISSIONS`**, which is
 * `Object.values(PERMISSIONS)` and therefore the backend catalog's own
 * declaration order. Not alphabetical: `organization` first and `uploads` last
 * reads as the product's own hierarchy, and sorting it would put `announcements`
 * above `organization` for no reason anyone could name.
 */
const build = (): PermissionGroup[] => {
  const groups = new Map<string, PermissionGroup>();

  for (const permission of ALL_PERMISSIONS) {
    // Every catalog entry is exactly `resource:action` — the one multi-word
    // action uses snake_case rather than a second colon, so a plain split is
    // safe (`docs/contracts/team.md` §11).
    const [resource = "", action = ""] = permission.split(":");

    let group = groups.get(resource);
    if (!group) {
      group = {
        resource,
        label: resource.charAt(0).toUpperCase() + resource.slice(1),
        standard: {},
        specials: [],
        all: [],
      };
      groups.set(resource, group);
    }

    if (STANDARD.has(action)) {
      group.standard[action as StandardAction] = permission;
    } else {
      group.specials.push({ permission, label: humanise(action) });
    }
    group.all.push(permission);
  }

  return [...groups.values()];
};

/** The 13 rows of the matrix. Frozen: this is data, and nothing may edit it. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = Object.freeze(
  build(),
);

/**
 * How many specials the widest row has, so the Special column can be sized once
 * for the whole table rather than jumping on the `members` row.
 */
export const MAX_SPECIALS = PERMISSION_GROUPS.reduce(
  (widest, group) => Math.max(widest, group.specials.length),
  0,
);
