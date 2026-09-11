import {
  ChartNoAxesColumn,
  CircleQuestionMark,
  FolderKanban,
  HandCoins,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Package,
  Receipt,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * Every path in the product, in one place, so a route rename is one edit and
 * `<Link href="/sales">` never drifts from the folder it points at. Dynamic
 * segments are functions rather than template strings at the call site, which
 * is what keeps the id in one position instead of five.
 */
export const ROUTES = {
  // Outside the shell (section 5).
  login: "/login",
  twoFactor: "/login/2fa",
  register: "/register",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  acceptInvite: "/accept-invite",
  onboarding: "/onboarding",
  /** The client-facing share link: no shell, no session, token in the path. */
  publicProject: (token: string) => `/p/${token}`,

  // Inside the shell.
  overview: "/overview",
  sales: "/sales",
  newSale: "/sales/new",
  sale: (id: string) => `/sales/${id}`,
  products: "/products",
  productNew: "/products/new",
  product: (id: string) => `/products/${id}`,
  productImport: "/products/import",
  customers: "/customers",
  customer: (id: string) => `/customers/${id}`,
  debts: "/debts",
  debtNew: "/debts/new",
  debt: (id: string) => `/debts/${id}`,
  reports: "/reports",
  reportsSales: "/reports/sales",
  reportsProducts: "/reports/products",
  reportsDebts: "/reports/debts",
  reportsCustomers: "/reports/customers",
  reportsStaff: "/reports/staff",
  announcements: "/announcements",
  /**
   * The reading screen for one notice. Deliberately absent from
   * `ROUTE_PERMISSIONS` below, like its parent: `announcements:view` is held by
   * every preset, so it inherits the parent's "open to every member" by
   * longest-prefix match and a row here would only add a way to be wrong.
   */
  announcement: (id: string) => `/announcements/${id}`,
  projects: "/projects",
  project: (id: string) => `/projects/${id}`,
  /** Members live at /team; Roles is its sub-page. */
  team: "/team",
  teamRoles: "/team/roles",
  /**
   * One member.
   *
   * A sibling of the literal `/team/roles`, which is safe: Next resolves a
   * literal segment ahead of a dynamic one, so `/team/roles` keeps reaching
   * the roles screen and never arrives here as an id.
   *
   * Deliberately NOT given its own `ROUTE_PERMISSIONS` row —
   * `resolveRoutePermission` falls back to the longest matching prefix, which
   * is `/team` and therefore `members:invite`. Member management is one
   * area and one gate; a Seller holds `members:view` so that a name can be
   * resolved on a receipt, not so they can open a colleague's record.
   */
  teamMember: (id: string) => `/team/${id}`,
  settings: "/settings",
  account: "/account",
  help: "/help",
} as const;

/**
 * The live counters a nav item may carry, named rather than imported.
 *
 * **A token, not a component.** This file is imported by Server Components,
 * by `lib/auth/route-permissions.ts` and by the server-side page gate; putting
 * a `"use client"` badge component in it would drag a React Query hook and its
 * whole feature into every one of those import graphs to describe a nav item.
 * `components/layout/nav.tsx` maps this string to the component and is the
 * only file that needs to know one exists — see `NAV_BADGES` there for why the
 * indirection is a token and not, say, a `count` number passed in.
 */
export type NavBadgeKey = "announcements-unread";

/**
 * `permission` omitted means the item is always visible. When present it is a
 * single permission the caller must hold; the sidebar drops the item entirely
 * rather than disabling it, because the brief (section 1.1) is explicit that a
 * Seller must not learn that Reports exists.
 *
 * `badge` names a live counter to hang off this one item. Omitted on every
 * item that does not have one, which is all of them but Announcements.
 */
export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  badge?: NavBadgeKey;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      { label: "Overview", href: ROUTES.overview, icon: LayoutDashboard },
      {
        label: "Sales",
        href: ROUTES.sales,
        icon: Receipt,
        permission: PERMISSIONS.SALES_VIEW,
      },
      {
        label: "Products",
        href: ROUTES.products,
        icon: Package,
        permission: PERMISSIONS.PRODUCTS_VIEW,
      },
      {
        label: "Customers",
        href: ROUTES.customers,
        icon: Users,
        permission: PERMISSIONS.CUSTOMERS_VIEW,
      },
      {
        label: "Debts",
        href: ROUTES.debts,
        icon: HandCoins,
        permission: PERMISSIONS.DEBTS_VIEW,
      },
      {
        label: "Reports",
        href: ROUTES.reports,
        icon: ChartNoAxesColumn,
        permission: PERMISSIONS.REPORTS_VIEW,
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        label: "Announcements",
        href: ROUTES.announcements,
        icon: Megaphone,
        // No `permission`: `announcements:view` is held by every preset, so
        // this row is visible to every member — and so is its badge, which is
        // gated on the same permission one layer down rather than here.
        badge: "announcements-unread",
      },
      {
        label: "Projects",
        href: ROUTES.projects,
        icon: FolderKanban,
        permission: PERMISSIONS.PROJECTS_VIEW,
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        label: "Members",
        href: ROUTES.team,
        icon: UsersRound,
        // Gated on MEMBERS_INVITE, not members:view. The backend's Seller
        // preset holds members:view so a seller can see who recorded a sale
        // (see the note in lib/auth/permissions.ts), so gating on view would
        // put the whole member-management screen in the counter staff's
        // sidebar. No Seller holds members:invite.
        permission: PERMISSIONS.MEMBERS_INVITE,
      },
      {
        label: "Settings",
        href: ROUTES.settings,
        icon: Settings,
        permission: PERMISSIONS.ORGANIZATION_UPDATE,
      },
    ],
  },
];

export const FOOTER_ITEMS: NavItem[] = [
  { label: "Help Center", href: ROUTES.help, icon: CircleQuestionMark },
];

/**
 * The permission a page needs before it may be opened at all, keyed by path.
 *
 * Wider than `NAV_GROUPS`: nav items are hidden from people who may not use
 * them, but a sub-page reached by a typed URL has no nav item to hide, so it
 * needs its own row here. `lib/auth/route-permissions.ts` resolves a pathname
 * against this with longest-prefix matching, so a detail route inherits its
 * parent's row (`/products/<id>` → `products:view`) and a stricter child
 * overrides it (`/products/import` → `products:create`).
 *
 * **Every value is the permission that gates that page's primary endpoint in
 * `docs/API-ROUTES.md`, not a guess from the page's name.** Two rows are
 * deliberately stricter than the endpoint that fills the screen, because the
 * screen exists to manage, not to read:
 *
 * - `/team` is `members:invite`, not `members:view` — the Seller preset holds
 *   `members:view` so a seller can see who recorded a sale (see the note in
 *   `lib/auth/permissions.ts`), and gating on it would put member management
 *   in the counter staff's hands.
 * - `/settings` is `organization:update`, not `organization:view` — every
 *   member holds view (it is what `GET /dashboard` runs on), so view would
 *   gate nothing at all.
 *
 * Paths absent from this map are open to every member: `/overview`,
 * `/announcements`, `/help` and `/account`. Their endpoints are gated on
 * permissions every preset holds (`organization:view`, `announcements:view`)
 * or on the session alone, so a row here would only add a way to be wrong.
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, Permission>> = {
  [ROUTES.sales]: PERMISSIONS.SALES_VIEW,
  [ROUTES.newSale]: PERMISSIONS.SALES_CREATE,
  [ROUTES.products]: PERMISSIONS.PRODUCTS_VIEW,
  // Both stricter than their `/products` parent, and both need it: a Seller
  // holds `products:view` and would otherwise reach a form whose every submit
  // is a 403.
  [ROUTES.productNew]: PERMISSIONS.PRODUCTS_CREATE,
  [ROUTES.productImport]: PERMISSIONS.PRODUCTS_CREATE,
  [ROUTES.customers]: PERMISSIONS.CUSTOMERS_VIEW,
  [ROUTES.debts]: PERMISSIONS.DEBTS_VIEW,
  // Stricter than its `/debts` parent, and it needs to be: the Seller preset
  // holds `debts:view` and `payments:create` but NOT `debts:create`
  // (`PRESET_SELLER` in `lib/auth/permissions.ts`), so a seller reading the
  // debt book would otherwise reach a form whose every submit is a 403.
  [ROUTES.debtNew]: PERMISSIONS.DEBTS_CREATE,
  [ROUTES.reports]: PERMISSIONS.REPORTS_VIEW,
  [ROUTES.projects]: PERMISSIONS.PROJECTS_VIEW,
  [ROUTES.team]: PERMISSIONS.MEMBERS_INVITE,
  [ROUTES.teamRoles]: PERMISSIONS.ROLES_VIEW,
  [ROUTES.settings]: PERMISSIONS.ORGANIZATION_UPDATE,
};
