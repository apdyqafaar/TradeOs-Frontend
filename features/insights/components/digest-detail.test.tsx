import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Digest } from "@/features/insights/types";
import { DigestDetail } from "./digest-detail";

const refetch = vi.fn();

let query: {
  data?: Digest;
  error: { status: number; message: string; requestId?: string } | null;
  isPending: boolean;
} = { data: undefined, error: null, isPending: false };

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useDigest: () => ({ ...query, refetch }),
}));

// The screen reads the shop's main currency for its `unit: "money"` figures.
// The real hook opens a `useQuery` against `/organizations/current/currency`,
// which needs a QueryClientProvider this spec has no reason to mount.
vi.mock("@/features/organization/hooks/use-currency-config", () => ({
  useCurrencyConfig: () => ({
    mainCurrency: "ETB",
    exchangeCurrency: "USD",
    exchangeRate: 130,
    hasExchange: true,
    isLoading: false,
  }),
}));

beforeEach(() => {
  refetch.mockClear();
  query = { data: undefined, error: null, isPending: false };
});

describe("DigestDetail", () => {
  it("treats a malformed id the same as a missing digest, with no Try again", () => {
    // `GET /digests/:id` validates `idParamSchema` BEFORE the handler
    // (`Backend/src/routes/v1/digest.route.ts:48`), so `/insights/abc` answers
    // **422**, not 404 — verified against `validate.middleware.ts` and
    // `ValidationError` (`util/errors.ts:116`). A shared or truncated link is
    // the most likely way to arrive at a wrong id, and it used to fall past
    // the 404 branch into a destructive card offering "Try again" on a
    // validation refusal that can never change its mind.
    query = {
      data: undefined,
      error: { status: 422, message: "Validation failed", requestId: "req_7" },
      isPending: false,
    };

    render(<DigestDetail id="abc" />);

    expect(screen.getByText(/this digest was removed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to insights/i }),
    ).toBeInTheDocument();
  });

  it("still says 'removed' for a 404", () => {
    query = {
      data: undefined,
      error: { status: 404, message: "Not found" },
      isPending: false,
    };

    render(<DigestDetail id="d1" />);

    expect(screen.getByText(/this digest was removed/i)).toBeInTheDocument();
  });

  it("keeps Try again for a failure that retrying could actually fix", () => {
    query = {
      data: undefined,
      error: { status: 500, message: "Server error", requestId: "req_8" },
      isPending: false,
    };

    render(<DigestDetail id="d1" />);

    expect(screen.getByRole("alert")).toHaveTextContent(/req_8/);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("never renders a blank area — the way back is in every branch", () => {
    // The paused state React Query's default `networkMode: "online"` produces
    // when the browser reports offline: `isPending: true, data: undefined,
    // error: null`. The screen used to reach `if (!digest.data) return null`
    // and render a completely empty content area — not even the back link,
    // which lives inside every other branch.
    query = { data: undefined, error: null, isPending: true };

    render(<DigestDetail id="d1" />);

    expect(
      screen.getByRole("link", { name: /back to insights/i }),
    ).toBeInTheDocument();
  });
});

describe("DigestDetail — the analysts' trace", () => {
  it("renders the same audit block `/insights` does, from the one component", () => {
    // This block was duplicated verbatim between `insights-screen.tsx` and
    // this file: same section, same heading, same three-number sentence, same
    // TraceView. Extracted to `<TraceSection>` before the two copies could
    // drift — the shape the bare-date bug had before `formatLocalDate` was
    // pulled out. Both screens are asserted, one here and one in
    // `insights-screen.test.tsx`, so a caller quietly dropping it is caught.
    query = {
      data: {
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
        trace: [
          {
            seq: 1,
            agent: "Sales analyst",
            tool: "getDailySales",
            input: {},
            summary: "Read yesterday's sales",
            output: {},
            ms: 12,
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          calls: 9,
          routerCalls: 4,
          costUsd: 0.08,
        },
        generatedAt: "2026-09-12T18:06:00.000Z",
        createdAt: "2026-09-12T18:06:00.000Z",
      },
      error: null,
      isPending: false,
    };

    render(<DigestDetail id="d1" />);

    expect(
      screen.getByText(/what the analysts looked at/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/9 analyst turns · 4 routing decisions · 1 tool calls/),
    ).toBeInTheDocument();
    expect(screen.getByText("Sales analyst")).toBeInTheDocument();
  });
});

/**
 * The header this screen grew when `DigestView` lost its own.
 *
 * `/insights` prints the day and the window above the digest, so a second copy
 * inside the panel would be the same fact twice on one page — but a digest
 * opened by id has no such header above it, and a dated record with no date on
 * it is worse than a duplicated one. The two timezone assertions that used to
 * live in `digest-view.test.tsx` moved here with the markup.
 */
describe("DigestDetail — the day, in the digest's own timezone", () => {
  const dated = (overrides: Partial<Digest>): Digest => ({
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
    trace: [],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      calls: 9,
      routerCalls: 4,
      costUsd: 0.08,
    },
    generatedAt: "2026-09-12T18:06:00.000Z",
    createdAt: "2026-09-12T18:06:00.000Z",
    ...overrides,
  });

  it("renders the bare `localDate` through formatLocalDate, not formatDate", () => {
    // `formatDate` does `new Date("2026-09-12")`, which JS parses as UTC
    // midnight, then re-renders that instant in a timezone — so for any zone
    // west of Greenwich it prints the day BEFORE the one the string names.
    // That exact mistake has shipped three times in this repo.
    query = { data: dated({}), error: null, isPending: false };

    render(<DigestDetail id="d1" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "12 Sep 2026",
    );
  });

  it("uses the zone stamped on the digest, not the organization's current one", () => {
    // Each row stores the zone it was written in (`digest.model.ts:32`)
    // precisely so history stays truthful after someone corrects a wrong
    // timezone in Settings. 02:06Z on the 13th is still the evening of the
    // 12th in New York, and a digest stamped there must render the day IT was
    // written.
    query = {
      data: dated({
        timezone: "America/New_York",
        generatedAt: "2026-09-13T02:06:00.000Z",
      }),
      error: null,
      isPending: false,
    };

    render(<DigestDetail id="d1" />);

    expect(screen.getByText(/written 12 Sep 2026 22:06/)).toBeInTheDocument();
    expect(screen.queryByText(/13 Sep 2026/)).not.toBeInTheDocument();
  });

  it("prints the window the digest covers, ending on the last day it INCLUDES", () => {
    // `period.to` is exclusive — the instant one calendar day after the last
    // day covered — so a run over 08–14 September carries local midnight
    // opening the 15th. Printing it raw is off by one, and "15 Sep" is a
    // perfectly plausible wrong answer.
    query = {
      data: dated({
        localDate: "2026-09-14",
        timezone: "Africa/Mogadishu",
        generatedAt: "2026-09-14T18:02:00.000Z",
        period: {
          preset: "last7",
          from: "2026-09-07T21:00:00.000Z",
          to: "2026-09-14T21:00:00.000Z",
        },
      }),
      error: null,
      isPending: false,
    };

    render(<DigestDetail id="d1" />);

    expect(
      screen.getByText(/Last 7 days · 08 – 14 Sep 2026/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/15 Sep/)).toBeNull();
  });

  it("says nothing about a window for a row written before the field existed", () => {
    // `publicDigest` omits `period` for those rows rather than back-filling
    // "today", precisely so a client cannot tell a guess from a fact. This does
    // the same: the day it was written is all such a row actually knows.
    query = { data: dated({}), error: null, isPending: false };

    render(<DigestDetail id="d1" />);

    expect(screen.queryByText(/Last 7 days/)).toBeNull();
    expect(screen.queryByText(/^Today ·/)).toBeNull();
  });
});
