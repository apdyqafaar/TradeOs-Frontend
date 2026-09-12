import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementsSection } from "./announcements-section";
import { DebtsSection } from "./debts-section";
import { MySalesSection } from "./my-sales-section";
import { ProjectsSection } from "./projects-section";
import { StockSection } from "./stock-section";

/**
 * Every row on the Overview opens the thing it is about.
 *
 * The Overview is a set of entry points, not a report — each panel exists to
 * say "this needs you", and a row you can read but not open makes the reader
 * go and find it again by hand. Only `<ProjectsSection>` did this; the other
 * four were read-only until 2026-09-12.
 *
 * **What these assert is the ITEM route, not merely "a link".** The failure
 * worth catching is the plausible one: linking a row to the list it came from
 * (`ROUTES.sales`) instead of the row's own page (`ROUTES.sale(id)`). That
 * still navigates, still looks deliberate in review, and quietly drops the
 * reader at the top of a list they must now search. Asserting the exact `href`
 * is the only thing that tells the two apart.
 *
 * Permissions are not re-checked here: the API only sends a section to someone
 * allowed to see it, and dynamic paths inherit their parent's permission
 * (`lib/auth/route-permissions.ts`), so `/sales/:id` is gated as `/sales` is.
 * What matters is that every preset that RECEIVES a section can open its rows —
 * `PRESET_SELLER` holds `sales:view` and `announcements:view`, checked when
 * these links were added.
 */

const money = (amount: number) => `ETB ${amount.toFixed(2)}`;
const TZ = "Africa/Addis_Ababa";

describe("Overview rows link to the item, not the list", () => {
  it("an announcement opens that announcement", () => {
    render(
      <AnnouncementsSection
        timezone={TZ}
        section={[
          {
            id: "a1",
            title: "Shop closed Monday",
            pinned: false,
            createdAt: "2026-09-11T09:00:00.000Z",
            author: { id: "m1", name: "Abdiqafaar" },
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Shop closed Monday" }),
    ).toHaveAttribute("href", "/announcements/a1");
  });

  it("a receipt opens that sale", () => {
    render(
      <MySalesSection
        money={money}
        timezone={TZ}
        variant="primary"
        section={{
          today: { count: 1, total: 95 },
          thisMonth: { count: 1, total: 95 },
          recent: [
            {
              id: "s1",
              number: "SL-0007",
              total: 95,
              paymentStatus: "paid",
              createdAt: "2026-09-11T14:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "SL-0007" })).toHaveAttribute(
      "href",
      "/sales/s1",
    );
  });

  it("an overdue row opens the DEBT, not the customer", () => {
    // The row is on screen because money is late. The next action is against
    // that account; the person is reached from the debt, not instead of it.
    render(
      <DebtsSection
        money={money}
        timezone={TZ}
        section={{
          outstanding: 2400,
          overdueAmount: 900,
          overdueCount: 1,
          dueWithin7Days: { count: 0, amount: 0 },
          overdue: [
            {
              debtId: "d1",
              customer: {
                id: "c1",
                name: "Juma Kiosk",
                phone: "+255754221900",
              },
              principal: 2400,
              remaining: 900,
              dueDate: "2026-08-20T00:00:00.000Z",
              daysOverdue: 22,
            },
          ],
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "Juma Kiosk" });
    expect(link).toHaveAttribute("href", "/debts/d1");
    expect(link).not.toHaveAttribute("href", "/customers/c1");
  });

  it("a low-stock row opens that product", () => {
    render(
      <StockSection
        section={{
          lowStockCount: 1,
          outOfStockCount: 0,
          lowStock: [
            {
              productId: "p1",
              name: "AA batteries 4pk",
              quantity: 3,
              threshold: 10,
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "AA batteries 4pk" }),
    ).toHaveAttribute("href", "/products/p1");
  });

  it("a project still opens that project", () => {
    // The one that was already right, kept here so the set is the whole
    // Overview rather than only the parts that were fixed.
    render(
      <ProjectsSection
        timezone={TZ}
        section={{
          inProgressCount: 3,
          dueSoon: [
            {
              id: "pr1",
              title: "Solar install — Hargeisa",
              dueDate: "2026-09-20T00:00:00.000Z",
              progress: 40,
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Solar install — Hargeisa" }),
    ).toHaveAttribute("href", "/projects/pr1");
  });

  it("keeps every section's own 'view all' pointing at the list", () => {
    // The item links must not have REPLACED these — a panel needs both: the
    // one that matters now, and the rest of them.
    render(
      <AnnouncementsSection
        timezone={TZ}
        section={[
          {
            id: "a1",
            title: "Shop closed Monday",
            pinned: false,
            createdAt: "2026-09-11T09:00:00.000Z",
            author: { id: "m1", name: "Abdiqafaar" },
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/announcements",
    );
  });
});
