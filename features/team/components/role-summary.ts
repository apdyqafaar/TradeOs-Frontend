import { WILDCARD } from "@/lib/auth/permissions";
import { PERMISSION_GROUPS } from "../lib/permission-catalog";
import type { Role } from "../types";

/**
 * One line describing what a role can do, for the help text under a role picker
 * and the second line of a roles-list row.
 *
 * The design writes this line by hand — "Sellers get the counter, products and
 * customers" (`docs/design/TradeOs-UI.dc.html:1281`). **That copy is not on the
 * wire.** `description` is a real field on the role document, but it is
 * optional, it is an omitted key when unset, and nothing guarantees the three
 * presets carry one: they are seeded from code at every server boot and the
 * seed is the only writer. So this falls back to a count rather than to a
 * hardcoded sentence per preset, which would be a second source of truth that
 * silently goes stale the first time a preset's permissions change.
 *
 * The count is stated in the two units that are meaningful to somebody
 * deciding: how many permissions, across how many areas of the product. "13
 * permissions in 9 areas" tells a manager more about the shape of a Seller than
 * "13" alone.
 */
export const roleSummary = (role: Role): string => {
  if (role.description) return role.description;

  // The Owner preset's whole array is the wildcard, which is not a count of
  // anything — and by design it grows silently whenever the backend adds a
  // permission, which is the point of it (`permissions.ts:98-99`).
  if (role.permissions.includes(WILDCARD)) {
    return "Everything, including permissions added in future updates";
  }

  const count = role.permissions.length;
  if (count === 0) return "No permissions yet";

  const granted = new Set(role.permissions);
  const areas = PERMISSION_GROUPS.filter((group) =>
    group.all.some((permission) => granted.has(permission)),
  ).length;

  const permissionWord = count === 1 ? "permission" : "permissions";
  const areaWord = areas === 1 ? "area" : "areas";

  return `${count} ${permissionWord} across ${areas} ${areaWord}`;
};
