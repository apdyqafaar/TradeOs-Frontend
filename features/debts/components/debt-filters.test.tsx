import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  DebtFilters,
  SetDebtFilters,
} from "@/features/debts/components/debt-status-tabs";
import { toDebtListParams } from "@/features/debts/components/debt-status-tabs";
import { DebtFiltersBar } from "./debt-filters";

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "ETB",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

const filters = (overrides: Partial<DebtFilters> = {}): DebtFilters => ({
  status: "open",
  search: "",
  minAmount: "",
  maxAmount: "",
  page: 1,
  limit: 25,
  ...overrides,
});

const renderBar = (overrides: Partial<DebtFilters> = {}) => {
  const setFilters = vi.fn() as unknown as SetDebtFilters;
  render(
    <DebtFiltersBar filters={filters(overrides)} setFilters={setFilters} />,
  );
  return setFilters as unknown as ReturnType<typeof vi.fn>;
};

describe("DebtFiltersBar", () => {
  it("commits a name search once the typing stops, and resets to page 1", async () => {
    // Page 7 of the unfiltered list is not page 7 of the filtered one.
    const setFilters = renderBar();
    const box = screen.getByRole("searchbox", { name: /customer name/i });

    await userEvent.type(box, "Juma");

    await waitFor(() =>
      expect(setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Juma", page: 1 }),
      ),
    );
  });

  it("debounces rather than firing a request per keystroke", async () => {
    // Typing "1500" un-debounced asks for 1, then 15, then 150, then 1500 —
    // three answers nobody wanted and three chances to show the wrong list.
    const setFilters = renderBar();
    await userEvent.type(
      screen.getByRole("textbox", { name: /smallest amount owed/i }),
      "1500",
    );

    await waitFor(() => expect(setFilters).toHaveBeenCalled());
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters).toHaveBeenCalledWith(
      expect.objectContaining({ minAmount: "1500" }),
    );
  });

  it("explains a reversed range instead of blanking the table", async () => {
    renderBar({ minAmount: "2000", maxAmount: "500" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/smallest amount has to be below/i);
    // The table is not told to go empty — it keeps the last good result.
    expect(alert).toHaveTextContent(/last result/i);
  });

  it("marks both boxes invalid while the range is unusable", () => {
    renderBar({ minAmount: "2000", maxAmount: "500" });

    expect(
      screen.getByRole("textbox", { name: /smallest amount owed/i }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("textbox", { name: /largest amount owed/i }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("says nothing about a half-open range, which is a real question", () => {
    // "Owes more than 500" is something a shopkeeper asks constantly. The
    // obvious wrong implementation treats the empty max as 0 and calls it
    // reversed.
    renderBar({ minAmount: "500" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers Clear only once something is filtering", async () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();

    const setFilters = renderBar({ search: "Juma" });
    const clear = screen.getByRole("button", { name: /clear/i });
    await userEvent.click(clear);

    expect(setFilters).toHaveBeenCalledWith({
      search: "",
      minAmount: "",
      maxAmount: "",
      page: 1,
    });
  });

  it("adopts a value that arrived from the back button", () => {
    // The box must never show text that is no longer filtering anything.
    renderBar({ search: "Bakaara" });
    expect(
      screen.getByRole("searchbox", { name: /customer name/i }),
    ).toHaveValue("Bakaara");
  });
});

describe("toDebtListParams", () => {
  it("drops an empty search rather than sending one", () => {
    // `search` is `z.string().trim().min(1)` on a `.strict()` schema, so
    // `?search=` is a 422 on the NORMAL state of this page. It is also the
    // React Query key: `{ search: "" }` and `{}` hash differently and would
    // cache the unfiltered list twice.
    expect(toDebtListParams(filters())).toEqual({
      page: 1,
      limit: 25,
      status: "open",
    });
  });

  it("sends a usable range as numbers", () => {
    expect(
      toDebtListParams(filters({ minAmount: "500", maxAmount: "2000" })),
    ).toEqual({
      page: 1,
      limit: 25,
      status: "open",
      minAmount: 500,
      maxAmount: 2000,
    });
  });

  it("sends a half-open range with only the end that was given", () => {
    const params = toDebtListParams(filters({ minAmount: "500" }));
    expect(params.minAmount).toBe(500);
    expect(params).not.toHaveProperty("maxAmount");
  });

  it("sends a zero, which is a real thing to ask for", () => {
    // `Number("")` is 0, so an implementation that coerced the empty box would
    // make "no filter" and "owes exactly nothing" the same request.
    const params = toDebtListParams(filters({ maxAmount: "0" }));
    expect(params.maxAmount).toBe(0);
  });

  it("sends NEITHER end while the range is unusable", () => {
    // The whole point of checking client-side: the server answers a reversed
    // range with a 422, and a request whose answer is already known is a
    // spinner followed by a red card.
    const params = toDebtListParams(
      filters({ minAmount: "2000", maxAmount: "500" }),
    );
    expect(params).not.toHaveProperty("minAmount");
    expect(params).not.toHaveProperty("maxAmount");
  });

  it("sends nothing numeric while a box holds text", () => {
    const params = toDebtListParams(filters({ minAmount: "abc" }));
    expect(params).not.toHaveProperty("minAmount");
  });
});
