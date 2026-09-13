import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestSummary } from "@/features/insights/types";
import { DigestHistory } from "./digest-history";

/**
 * The six states CLAUDE.md requires of every list. Five were here; the 403 was
 * not, and this was the only new list on the branch without one.
 */

const refetch = vi.fn();

let query: {
  data?: { items: DigestSummary[]; meta: { page: number; totalPages: number } };
  error: { status: number; message: string; requestId?: string } | null;
  isPending: boolean;
} = { data: undefined, error: null, isPending: false };

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useDigests: () => ({ ...query, refetch }),
}));

const summary = (): DigestSummary => ({
  id: "d1",
  localDate: "2026-09-12",
  timezone: "Africa/Addis_Ababa",
  language: "en",
  model: "m",
  trigger: "cron",
  status: "complete",
  stoppedBy: "complete",
  sections: {
    sales: {
      headline: "A steady Saturday",
      points: [],
      comparison: { vsLastWeek: "flat", monthToDate: "flat" },
      anomalies: [],
    },
    debts: null,
    stock: null,
    team: null,
    recommendations: null,
  },
  errors: [],
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    calls: 9,
    routerCalls: 4,
    costUsd: 0.08,
  },
  generatedAt: "2026-09-12T18:06:00.000Z",
  createdAt: "2026-09-12T18:06:00.000Z",
});

beforeEach(() => {
  refetch.mockClear();
  query = { data: undefined, error: null, isPending: false };
});

describe("DigestHistory", () => {
  it("lists each digest by its local day and status", () => {
    query = {
      data: { items: [summary()], meta: { page: 1, totalPages: 1 } },
      error: null,
      isPending: false,
    };

    render(<DigestHistory timezone="Africa/Addis_Ababa" />);

    expect(screen.getByRole("link", { name: /12 Sep 2026/ })).toHaveAttribute(
      "href",
      "/insights/d1",
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("offers Try again when the list genuinely failed", () => {
    query = {
      data: undefined,
      error: { status: 500, message: "Server error", requestId: "req_5" },
      isPending: false,
    };

    render(<DigestHistory timezone="Africa/Addis_Ababa" />);

    expect(screen.getByRole("alert")).toHaveTextContent(/req_5/);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("offers no Try again on a 403, which would 403 identically every time", () => {
    // The reachable path: a member is looking at `/insights` when an Owner
    // removes `reports:view` from their role. The cached `latest` stays on
    // screen (no interval, no refetchOnWindowFocus), so the page does not
    // notice — then they press **Older**, which is a new query key, and this
    // list is the first thing to get the 403. Nothing broke; they simply may
    // not read these any more, and `ErrorCard`'s own docblock says to omit
    // `retry` for exactly that. `previous-jobs.tsx` is the same list one
    // feature over and already does it.
    query = {
      data: undefined,
      error: { status: 403, message: "Forbidden", requestId: "req_6" },
      isPending: false,
    };

    render(<DigestHistory timezone="Africa/Addis_Ababa" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });
});
