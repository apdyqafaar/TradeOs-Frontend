import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEBT_STATUS_FILTERS } from "@/features/debts/types";
import {
  type DebtFilters,
  DebtStatusTabs,
  toDebtListParams,
} from "./debt-status-tabs";

/**
 * The tabs themselves are six buttons; what is worth protecting is that they
 * are the *right* six and that the URL state they drive translates into a query
 * `listDebtsQuerySchema` will accept, because that schema is `.strict()` — an
 * extra key is a 422 rather than a filter the server quietly ignores.
 */

const filters = (overrides: Partial<DebtFilters> = {}): DebtFilters => ({
  status: "open",
  page: 1,
  limit: 25,
  ...overrides,
});

describe("DebtStatusTabs", () => {
  it("offers exactly the six values `?status=` accepts, in the API's order", () => {
    // Rendered from `DEBT_STATUS_FILTERS`, which is transcribed from
    // `debt.validation.ts:18`. A seventh tab would be a 422 on a `.strict()`
    // schema, and a missing one hides a filter that exists — so the count and
    // the order are both asserted against the constant rather than a literal.
    render(
      <DebtStatusTabs status="open" onStatusChange={vi.fn()} panelId="panel" />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(DEBT_STATUS_FILTERS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Open",
      "Overdue",
      "Paid",
      "Written off",
      "Cancelled",
      "All",
    ]);
  });

  it("marks the selected tab and reports the value the API takes", async () => {
    const onStatusChange = vi.fn();
    render(
      <DebtStatusTabs
        status="overdue"
        onStatusChange={onStatusChange}
        panelId="panel"
      />,
    );

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Overdue",
    );

    // The label is "Written off"; the value has to be the enum member
    // `written_off`, not the label lower-cased.
    await userEvent.click(screen.getByRole("tab", { name: "Written off" }));
    expect(onStatusChange).toHaveBeenCalledWith("written_off");
  });

  it("carries no per-tab counts, because five of the six are unknown", () => {
    // `GET /debts` answers `meta.total` for the filter it was asked for, so
    // only the selected tab's count exists without five more requests. The
    // canvas draws a number beside every label; faking five of them on a screen
    // about money owed is worse than moving the one real count to the header.
    render(
      <DebtStatusTabs status="open" onStatusChange={vi.fn()} panelId="panel" />,
    );

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.textContent).not.toMatch(/\d/);
    }
  });
});

describe("toDebtListParams", () => {
  it("sends page, limit and status — and nothing else", () => {
    // `listDebtsQuerySchema` is `.strict()`: `page`, `limit`, `status`,
    // `customerId`. Any other key — a `search`, a `sort`, a date window — is a
    // 422, and none of them exists on this endpoint at all.
    const params = toDebtListParams(filters({ status: "overdue", page: 3 }));

    expect(params).toEqual({ page: 3, limit: 25, status: "overdue" });
  });

  it("still sends the default status rather than relying on the server's", () => {
    // The backend defaults an absent `status` to `"open"`, so both spellings
    // fetch the same rows — but `{}` and `{ status: "open" }` hash to two
    // different React Query keys for one identical request, which is two cache
    // entries and a refetch every time the URL drops back to its default.
    expect(toDebtListParams(filters()).status).toBe("open");
  });
});
