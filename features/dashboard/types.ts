/**
 * The wire shapes of `GET /dashboard`.
 *
 * Every interface below is transcribed field for field from a `build*Section`
 * function in `../Backend/src/services/dashboard/`, and the registry that
 * assembles them is `../Backend/src/services/dashboard.service.ts`. The
 * endpoint takes no parameters and returns *only* the sections the caller's
 * permissions allow (see `DashboardResponse`), so a wrong field name here does
 * not fail loudly — it renders as a blank cell. Change one of these only
 * against the backend source.
 *
 * Dates cross the wire as JSON, so every backend `Date` is an ISO 8601
 * `string` here. Feed them to `formatDate(iso, timezone)` with the business
 * timezone, never to `toLocaleDateString`.
 */

/** `organization.section.ts`. No permission — every member gets this one. */
export interface DashboardOrganizationSection {
  id: string;
  name: string;
  /** `null` when the business has not uploaded a logo. */
  logo: string | null;
  /** IANA zone, e.g. `Africa/Nairobi`. The argument every `formatDate` call needs. */
  timezone: string;
  /**
   * `null` when the currency config row is missing. Treat that as unknown
   * rather than falling back to a hardcoded code — this market mixes
   * currencies and the wrong one is worse than none.
   */
  currency: { main: string; exchange: string; rate: number } | null;
}

/** `me.section.ts`. No permission. `role` is an object, not a name string. */
export interface DashboardMeSection {
  memberId: string;
  name: string;
  email: string;
  role: { id: string; name: string };
  /** The role's flattened permission list; may contain `"*"` for the Owner preset. */
  permissions: string[];
}

/** One row of `announcements.section.ts`. */
export interface DashboardAnnouncement {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

/**
 * `announcements.section.ts`. No permission. The section's value **is** the
 * array — latest 3, pinned first — not an object wrapping one.
 */
export type DashboardAnnouncementsSection = DashboardAnnouncement[];

/** One row of `mySales.recent` — the caller's own last five completed sales. */
export interface DashboardMySalesRecent {
  id: string;
  number: string;
  total: number;
  paymentStatus: "paid" | "partial" | "credit";
  createdAt: string;
}

/** `my-sales.section.ts`. Needs `sales:create`. The caller's own sales only. */
export interface DashboardMySalesSection {
  today: { count: number; total: number };
  thisMonth: { count: number; total: number };
  recent: DashboardMySalesRecent[];
}

/** The `today` / `thisMonth` figures in the `sales` section. */
export interface DashboardSalesTotals {
  revenue: number;
  grossProfit: number;
  /** The section renames the report's `salesCount` to `count`. */
  count: number;
}

/** One bucket of `sales.trend7.series`. `bucket` is a label (`2026-09-07`), not a date. */
export interface DashboardTrendBucket {
  bucket: string;
  revenue: number;
  profit: number;
  count: number;
}

/**
 * `sales.section.ts`. Needs `reports:view`.
 *
 * The trend key is **`trend7`**, not `trend`: it is fixed at the last 7 local
 * calendar days and always answers with `granularity: "day"`. The union stays
 * wide because the shape is `getSalesTrend`'s, which the Reports pages reuse
 * at other granularities.
 */
export interface DashboardSalesSection {
  today: DashboardSalesTotals;
  thisMonth: DashboardSalesTotals;
  trend7: {
    granularity: "day" | "week" | "month";
    series: DashboardTrendBucket[];
  };
}

/** One row of `debts.overdue` — worst first, capped at 10. */
export interface DashboardOverdueDebt {
  debtId: string;
  /** `name` and `phone` fall back to `""` when the customer row has gone. */
  customer: { id: string; name: string; phone: string };
  principal: number;
  remaining: number;
  dueDate: string;
  daysOverdue: number;
}

/**
 * `debts.section.ts`. Needs `debts:view`.
 *
 * `overdueCount` is the *full* overdue count, not `overdue.length` — render
 * "and N more" as `overdueCount - overdue.length` and link to the debts list
 * for the rest.
 */
export interface DashboardDebtsSection {
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  dueWithin7Days: { count: number; amount: number };
  overdue: DashboardOverdueDebt[];
}

/** One row of `stock.lowStock` — the five lowest tracked products. */
export interface DashboardLowStockProduct {
  productId: string;
  name: string;
  quantity: number;
  /** `null` when the product carries no low-stock threshold. */
  threshold: number | null;
}

/**
 * `stock.section.ts`. Needs `products:view`.
 *
 * Both counts are the stock report's list lengths, and those lists are capped
 * at 50 upstream — a business with 300 low products reports 50, not 300. Do
 * not present either number as an exact total.
 */
export interface DashboardStockSection {
  lowStockCount: number;
  outOfStockCount: number;
  lowStock: DashboardLowStockProduct[];
}

/** One row of `staff.today` — the top 5 sellers by revenue today. */
export interface DashboardStaffRow {
  memberId: string;
  name: string;
  count: number;
  revenue: number;
}

/** `staff.section.ts`. Needs `reports:view` **and** `members:view`. */
export interface DashboardStaffSection {
  today: DashboardStaffRow[];
}

/** One row of `projects.dueSoon` — in progress, due within 14 days, capped at 3. */
export interface DashboardDueSoonProject {
  id: string;
  title: string;
  dueDate: string;
  /** 0–100. */
  progress: number;
}

/** `projects.section.ts`. Needs `projects:view`. */
export interface DashboardProjectsSection {
  inProgressCount: number;
  dueSoon: DashboardDueSoonProject[];
}

/**
 * `team.section.ts`. Needs `members:view` **and** `members:invite` — the pair,
 * deliberately, so a Seller (who holds `members:view` alone, to see who
 * recorded a sale) does not receive this section.
 */
export interface DashboardTeamSection {
  activeCount: number;
  invitedCount: number;
}

/**
 * Every section the endpoint can return, keyed exactly as the backend registry
 * keys them, in the registry's own fixed order.
 */
export interface DashboardSections {
  organization: DashboardOrganizationSection;
  me: DashboardMeSection;
  announcements: DashboardAnnouncementsSection;
  mySales: DashboardMySalesSection;
  sales: DashboardSalesSection;
  debts: DashboardDebtsSection;
  stock: DashboardStockSection;
  staff: DashboardStaffSection;
  projects: DashboardProjectsSection;
  team: DashboardTeamSection;
}

/** `"sales" | "debts" | …` — the ten keys, as a type. */
export type DashboardSectionKey = keyof DashboardSections;

/**
 * The whole Overview in one response.
 *
 * `sections` is `Partial` because the endpoint is permission-shaped: it builds
 * only the sections the caller may see and omits the rest entirely rather than
 * sending them empty. A Seller and an Owner call the same URL and get
 * different keys back, which is why the page is a stack of optional sections
 * rather than a branch on a role name.
 *
 * `available` lists exactly the keys present in `sections`, in registry order.
 * It stays `string[]` rather than `DashboardSectionKey[]` on purpose: the API
 * can add a section this build has never heard of, and a narrower type would
 * turn that into a cast at every call site.
 */
export interface DashboardResponse {
  available: string[];
  sections: Partial<DashboardSections>;
}
