import { FOOTER_ITEMS, NAV_GROUPS, ROUTES } from "@/config/routes";

/** Every href the sidebar can light up, flattened once at module load. */
export const NAV_HREFS: readonly string[] = [
  ...NAV_GROUPS.flatMap((group) => group.items).map((item) => item.href),
  ...FOOTER_ITEMS.map((item) => item.href),
];

/**
 * The href of the nav item that owns `pathname`, or null when none does.
 *
 * Prefix matching alone marks two items active at once as soon as one href is
 * a prefix of another (`/team` and a future `/team/roles` item), so the
 * longest match wins and every shorter one loses. Nested paths that are not
 * themselves nav items still light their section: `/sales/new` has no item of
 * its own, so `/sales` is the longest match and Sales stays lit.
 */
export function resolveActiveHref(
  pathname: string,
  hrefs: readonly string[] = NAV_HREFS,
): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }

  return best;
}

/** Sub-pages that are not nav items but still deserve a real crumb. */
const SUB_PAGE_LABELS: Record<string, string> = {
  [ROUTES.newSale]: "New sale",
  [ROUTES.productImport]: "Import",
  [ROUTES.reportsSales]: "Sales",
  [ROUTES.reportsProducts]: "Products",
  [ROUTES.reportsDebts]: "Debts",
  [ROUTES.reportsCustomers]: "Customers",
  [ROUTES.reportsStaff]: "Staff",
  [ROUTES.teamRoles]: "Roles",
  [ROUTES.account]: "Account",
};

const NAV_LABELS: Record<string, string> = Object.fromEntries(
  [...NAV_GROUPS.flatMap((group) => group.items), ...FOOTER_ITEMS].map(
    (item) => [item.href, item.label],
  ),
);

export type Breadcrumb = { label: string; href: string };

/**
 * A crumb per path segment, labelled from the nav table first and the sub-page
 * table second. A record id has no name until its page loads it, so this stops
 * at "Detail" rather than printing a cuid; a page that knows the receipt number
 * can render its own title row over the top.
 */
export function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [];
  let href = "";

  for (const segment of pathname.split("/").filter(Boolean)) {
    href += `/${segment}`;
    crumbs.push({
      href,
      label:
        NAV_LABELS[href] ?? SUB_PAGE_LABELS[href] ?? humanizeSegment(segment),
    });
  }

  return crumbs;
}

function humanizeSegment(segment: string): string {
  // cuids and uuids carry digits or capitals; slugs never do.
  if (!/^[a-z][a-z-]*$/.test(segment)) return "Detail";
  const words = segment.replace(/-/g, " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/**
 * One or two letters for an avatar square. Names arrive in Somali, Swahili and
 * Arabic scripts, so this splits on whitespace and takes whole code points
 * rather than assuming a Latin first/last name.
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";

  return (first + last).toLocaleUpperCase();
}
