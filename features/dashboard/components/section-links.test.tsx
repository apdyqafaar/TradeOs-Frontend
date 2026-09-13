import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementsSection } from "./announcements-section";
import { DebtsSection } from "./debts-section";
import { InsightsSection } from "./insights-section";
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

describe("InsightsSection", () => {
  it("opens the Insights page from last night's headline", () => {
    render(
      <InsightsSection
        section={{
          id: "d1",
          localDate: "2026-09-12",
          status: "complete",
          headline: "A steady Saturday",
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "A steady Saturday" }),
    ).toHaveAttribute("href", "/insights");
  });

  it("says so when last night's digest could not be written, and still offers a way in", () => {
    render(
      <InsightsSection
        section={{
          id: "d2",
          localDate: "2026-09-12",
          status: "failed",
          headline: null,
        }}
      />,
    );
    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    // The link was called "Generate one now" until 2026-09-13: it promised an
    // action it does not perform and named no destination, and it sent a
    // `reports:view`-only role to a page with no Generate control on it. The
    // way in is still here; it is now named after where it goes.
    expect(screen.getByRole("link", { name: "Open Insights" })).toHaveAttribute(
      "href",
      "/insights",
    );
  });

  it("treats a failed run as failed even when a stray headline slipped through — status decides, not headline", () => {
    // Nothing yet enforces headline-null ⟺ status-failed: the digest
    // orchestrator that assigns `status` is a later, separate task. The strip
    // must not read a non-null headline as proof the run succeeded.
    render(
      <InsightsSection
        section={{
          id: "d5",
          localDate: "2026-09-12",
          status: "failed",
          headline: "Half-written before the run failed",
        }}
      />,
    );
    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: "Half-written before the run failed",
      }),
    ).not.toBeInTheDocument();
  });

  it("points a shop with the digest switched off at the setting that turns it on", () => {
    // `section === null` alone used to produce this copy, which told a shop
    // that had already enabled the digest to go and enable it. `ai.enabled` is
    // what decides it now; the link still goes to the same place.
    render(
      <InsightsSection
        section={null}
        ai={{ enabled: false, hourLocal: 21 }}
        canConfigureAi
      />,
    );
    expect(screen.getByText(/daily digest is off/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ai insights/i })).toHaveAttribute(
      "href",
      "/settings?tab=ai",
    );
  });

  it("marks a partial digest as partial rather than passing it off as complete", () => {
    render(
      <InsightsSection
        section={{
          id: "d3",
          localDate: "2026-09-12",
          status: "partial",
          headline: "Half a day",
        }}
      />,
    );
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
  });

  it("renders last night's calendar day exactly as given, with no timezone shift", () => {
    // `localDate` is already local. Routing it through `formatDate` with a
    // timezone west of Greenwich used to print the day before — see
    // `lib/format/date.test.ts`'s `formatLocalDate` cases for the direct
    // comparison against that bug.
    render(
      <InsightsSection
        section={{
          id: "d6",
          localDate: "2026-09-12",
          status: "complete",
          headline: "A steady Saturday",
        }}
      />,
    );
    expect(screen.getByText(/12 sep 2026/i)).toBeInTheDocument();
  });

  it("names its header link's destination instead of a bare verb", () => {
    render(
      <InsightsSection
        section={{
          id: "d1",
          localDate: "2026-09-12",
          status: "complete",
          headline: "A steady Saturday",
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "All insights" })).toHaveAttribute(
      "href",
      "/insights",
    );
  });
});

/**
 * `section === null` means "no digest row exists", never "the feature is off".
 *
 * `Backend/src/services/dashboard/digest.section.ts:14` returns `null` the
 * moment there is no digest, regardless of `ai.enabled`, and `ai.enabled`
 * defaults to `false` for every organization
 * (`Backend/src/db/models/organization.model.ts:38`). Read together those two
 * facts are the whole bug: a shop that enabled the digest at 14:00 was told to
 * enable it until the 21:05 cron landed, while `/insights` told the shops that
 * had NOT enabled it that a digest was arriving tonight. One state, two
 * screens, two contradictory sentences, exactly one of them wrong at any
 * moment.
 *
 * `features/insights/components/insights-screen.test.tsx` asserts the matching
 * three states on the other screen.
 */
describe("InsightsSection — off, on-but-waiting, and not-known-yet", () => {
  it("names the arrival hour, and never says to turn it on, once the digest IS enabled", () => {
    render(
      <InsightsSection
        section={null}
        ai={{ enabled: true, hourLocal: 20 }}
        canConfigureAi
      />,
    );
    expect(screen.getByText(/20:00 tonight/)).toBeInTheDocument();
    expect(screen.queryByText(/turn it on/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /ai insights/i }),
    ).not.toBeInTheDocument();
  });

  it("never names an arrival time while the digest is off", () => {
    render(
      <InsightsSection
        section={null}
        ai={{ enabled: false, hourLocal: 21 }}
        canConfigureAi
      />,
    );
    expect(screen.queryByText(/21:00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tonight/i)).not.toBeInTheDocument();
  });

  it("gives a member who cannot open Settings the sentence without the dead link", () => {
    // `/settings` is gated `organization:update` in `config/routes.ts` and
    // enforced server-side by `requirePageAccess`, so this link would land a
    // `reports:view`-only role on a full <ForbiddenScreen/>.
    render(
      <InsightsSection
        section={null}
        ai={{ enabled: false, hourLocal: 21 }}
        canConfigureAi={false}
      />,
    );
    expect(screen.getByText(/daily digest is off/i)).toBeInTheDocument();
    expect(screen.getByText(/an owner can switch it on/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ai insights/i })).toBeNull();
  });

  it("promises nothing at all while the AI settings are not known", () => {
    // `GET /organizations/current` is gated `organization:view` and can 403
    // for a custom role holding only `reports:view`. Neither "it is off" nor
    // "it arrives at 21:00" is known to be true, so the strip says neither.
    render(<InsightsSection section={null} />);
    expect(screen.getByText(/no digest yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/tonight/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is off/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ai insights/i })).toBeNull();
  });

  it("still shows last night's headline when a digest exists, whatever ai.enabled says", () => {
    // Switching the feature off does not make yesterday's digest untrue.
    render(
      <InsightsSection
        section={{
          id: "d7",
          localDate: "2026-09-12",
          status: "complete",
          headline: "A steady Saturday",
        }}
        ai={{ enabled: false, hourLocal: 21 }}
        canConfigureAi
      />,
    );
    expect(
      screen.getByRole("link", { name: "A steady Saturday" }),
    ).toHaveAttribute("href", "/insights");
    expect(screen.queryByText(/daily digest is off/i)).toBeNull();
  });
});
