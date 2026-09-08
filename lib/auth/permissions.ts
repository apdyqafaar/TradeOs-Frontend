/**
 * A mirror of the backend's permission catalog (`Backend/src/lib/permissions.ts`).
 *
 * This file exists so a permission string is a compile-time value here too: a
 * typo in `useCan("sales:crate")` is a type error rather than a silently
 * always-false check that hides a button forever. It is a MIRROR, not a
 * source — the API enforces the real rules, and every value here must match
 * the backend exactly. When the backend adds a permission, add it here in the
 * same shape and update `PRESET_SELLER` below if the Seller preset changed.
 */
export const PERMISSIONS = {
  ORGANIZATION_VIEW: "organization:view",
  ORGANIZATION_UPDATE: "organization:update",
  ORGANIZATION_DELETE: "organization:delete",

  MEMBERS_VIEW: "members:view",
  MEMBERS_INVITE: "members:invite",
  MEMBERS_UPDATE: "members:update",
  MEMBERS_REMOVE: "members:remove",

  ROLES_VIEW: "roles:view",
  ROLES_CREATE: "roles:create",
  ROLES_UPDATE: "roles:update",
  ROLES_DELETE: "roles:delete",

  CUSTOMERS_VIEW: "customers:view",
  CUSTOMERS_CREATE: "customers:create",
  CUSTOMERS_UPDATE: "customers:update",
  CUSTOMERS_DELETE: "customers:delete",

  PRODUCTS_VIEW: "products:view",
  PRODUCTS_CREATE: "products:create",
  PRODUCTS_UPDATE: "products:update",
  PRODUCTS_DELETE: "products:delete",
  PRODUCTS_ADJUST_STOCK: "products:adjust_stock",

  CATEGORIES_VIEW: "categories:view",
  CATEGORIES_CREATE: "categories:create",
  CATEGORIES_UPDATE: "categories:update",
  CATEGORIES_DELETE: "categories:delete",

  SALES_VIEW: "sales:view",
  SALES_CREATE: "sales:create",
  SALES_VOID: "sales:void",

  DEBTS_VIEW: "debts:view",
  DEBTS_CREATE: "debts:create",
  DEBTS_WRITE_OFF: "debts:write_off",

  PAYMENTS_CREATE: "payments:create",
  PAYMENTS_VOID: "payments:void",

  REPORTS_VIEW: "reports:view",

  ANNOUNCEMENTS_VIEW: "announcements:view",
  ANNOUNCEMENTS_CREATE: "announcements:create",
  ANNOUNCEMENTS_UPDATE: "announcements:update",
  ANNOUNCEMENTS_DELETE: "announcements:delete",

  PROJECTS_VIEW: "projects:view",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_UPDATE: "projects:update",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_PUBLISH: "projects:publish",

  UPLOADS_CREATE: "uploads:create",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/**
 * The Owner preset holds this instead of an enumerated list, so a permission
 * added by a later backend phase reaches owners without a migration. Treat any
 * granted list containing it as granting everything.
 */
export const WILDCARD = "*";

/**
 * `granted` is `readonly string[]` rather than `Permission[]` because it comes
 * off the wire from `GET /auth/me` and may legitimately contain the wildcard
 * or a permission this build has not heard of yet. `required` stays
 * `Permission` so the call site gets its typo caught.
 */
export const hasPermission = (
  granted: readonly string[],
  required: Permission,
): boolean => granted.includes(WILDCARD) || granted.includes(required);

/** True when every one of `required` is held. */
export const hasEveryPermission = (
  granted: readonly string[],
  required: readonly Permission[],
): boolean =>
  required.every((permission) => hasPermission(granted, permission));

/** True when at least one of `required` is held. */
export const hasSomePermission = (
  granted: readonly string[],
  required: readonly Permission[],
): boolean => required.some((permission) => hasPermission(granted, permission));

/**
 * The Seller preset, copied from the backend, kept here only as documentation
 * for anyone deciding which permission should gate a piece of UI.
 *
 * Two entries surprise people and have already caused one wrong nav gate:
 * a Seller holds `members:view` (they need to see who recorded a sale) and
 * `customers:update`. So **`members:view` is the wrong gate for the Members
 * page** — gate management screens on an action permission such as
 * `members:invite`, which no Seller holds.
 */
export const PRESET_SELLER: readonly Permission[] = [
  PERMISSIONS.ORGANIZATION_VIEW,
  PERMISSIONS.MEMBERS_VIEW,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.CATEGORIES_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.CUSTOMERS_CREATE,
  PERMISSIONS.CUSTOMERS_UPDATE,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.DEBTS_VIEW,
  PERMISSIONS.PAYMENTS_CREATE,
  PERMISSIONS.ANNOUNCEMENTS_VIEW,
  PERMISSIONS.PROJECTS_VIEW,
];
