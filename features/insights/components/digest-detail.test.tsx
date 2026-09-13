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
