import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunDigestButton } from "./run-digest-button";

/**
 * Every mocked `mutate` call resolves synchronously by calling `onSuccess`
 * with this `localDate` — the polling/give-up tests need `waitingFor` to
 * actually get set, not just `mutate` to have been called.
 */
const mutate = vi.fn(
  (
    _vars: undefined,
    options?: { onSuccess?: (result: { localDate: string }) => void },
  ) => {
    options?.onSuccess?.({ localDate: "2026-09-12" });
  },
);
let error: {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
} | null = null;

/**
 * What `latest` answers on each poll.
 *
 * This used to be hardcoded `{ data: undefined }` for **every** test in the
 * file, so the digest never landed in any of them and the whole success effect
 * could have been deleted with the suite staying green. It is settable now,
 * and the tests below drive it through a real "run lands" transition.
 */
let latestData:
  | { id: string; localDate: string; generatedAt: string }
  | undefined;

vi.mock("@/features/insights/hooks/use-digests", async (importOriginal) => ({
  // `quotaFromRefusal` is a pure function in the same module, and the button
  // renders the refusal's OWN numbers through it. Re-exporting the real one
  // rather than stubbing it means the "you've used today's N runs" copy is
  // exercised against the real `details` shape, not against a fixture of it.
  ...(await importOriginal<
    typeof import("@/features/insights/hooks/use-digests")
  >()),
  useRunDigest: () => ({ mutate, isPending: false, error }),
  useLatestDigest: () => ({ data: latestData }),
}));

beforeEach(() => {
  mutate.mockClear();
  error = null;
  latestData = undefined;
});

describe("RunDigestButton", () => {
  it("posts on click", async () => {
    render(<RunDigestButton sinceLocalDate={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: /generate now/i }),
    );
    expect(mutate).toHaveBeenCalled();
  });

  it("offers to run again once a digest already exists", () => {
    render(<RunDigestButton sinceLocalDate="2026-09-11" />);
    expect(
      screen.getByRole("button", { name: /generate again/i }),
    ).toBeInTheDocument();
  });

  it("a spent allowance says so, where the click happened, in the SERVER's numbers", () => {
    // `POST /digests/run` answers 429 twice over, and these are the two. This
    // one is `DIGEST_QUOTA_EXHAUSTED`: today's runs are gone.
    //
    // The count comes out of the refusal's `details`, never out of a literal.
    // The canvas drew "2 of 3"; `AI_MANUAL_RUNS_PER_DAY` ships as **2**, and a
    // deployment can tune it — so a hardcoded "three manual runs" is wrong on
    // the shipped default and wrong again for anyone who changes it.
    error = {
      status: 429,
      code: "DIGEST_QUOTA_EXHAUSTED",
      message: "used its 2 insight runs",
      details: {
        limit: 2,
        used: 2,
        remaining: 0,
        resetsAt: "2026-09-13T21:00:00.000Z",
      },
    };
    render(<RunDigestButton sinceLocalDate="2026-09-12" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /today's 2 manual runs/i,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(/three/i);
  });

  it("tells 'too fast' apart from 'none left', which are the SAME status on the same route", () => {
    // The loop shield, not the daily allowance. A client branching on
    // `status === 429` would tell an owner with two runs in hand that they had
    // spent them — which is why the backend gave the two different codes.
    error = { status: 429, code: "TOO_MANY_REQUESTS", message: "Too many" };
    render(<RunDigestButton sinceLocalDate="2026-09-12" />);
    expect(screen.getByRole("status")).toHaveTextContent(/too quick/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/used/i);
  });

  it("says a refused date range cost nothing, because it genuinely did not", () => {
    // The period is resolved BEFORE the allowance is spent, so a typo in a
    // custom range is free. Saying so is what makes the control usable: "will
    // this cost me one of my two runs?" is the question that stops an owner
    // trying.
    error = {
      status: 400,
      code: "PERIOD_TOO_LONG",
      message: "Range too long",
    };
    render(<RunDigestButton sinceLocalDate="2026-09-12" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /did not cost you a run/i,
    );
  });
});

describe("RunDigestButton — the allowance line", () => {
  it("renders both numbers from the server, never the canvas's literal", () => {
    render(
      <RunDigestButton
        sinceLocalDate={null}
        quota={{
          limit: 2,
          used: 1,
          remaining: 1,
          resetsAt: "2026-09-13T21:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText("1 of 2 left today")).toBeInTheDocument();
  });

  it("says when the allowance comes back once it is spent", () => {
    render(
      <RunDigestButton
        sinceLocalDate={null}
        quota={{
          limit: 2,
          used: 2,
          remaining: 0,
          resetsAt: "2026-09-13T21:00:00.000Z",
        }}
      />,
    );
    expect(
      screen.getByText(/0 of 2 left today · back after midnight/),
    ).toBeInTheDocument();
  });

  it("renders NOTHING when the allowance is unknown, rather than '0 of 0 left today'", () => {
    // A 403 or an older API build leaves this null. "0 of 0" is
    // indistinguishable from a spent allowance and would stop an owner who
    // actually has runs in hand from pressing the button.
    render(<RunDigestButton sinceLocalDate={null} quota={null} />);
    expect(screen.queryByText(/left today/)).toBeNull();
  });

  it("a disabled organization is pointed at Settings", () => {
    error = {
      status: 409,
      code: "AI_DISABLED_FOR_ORGANIZATION",
      message: "off",
    };
    render(<RunDigestButton sinceLocalDate={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Settings/);
  });

  it("an unconfigured server says so, not the raw message", () => {
    error = {
      status: 503,
      code: "AI_NOT_CONFIGURED",
      message: "AI provider missing",
    };
    render(<RunDigestButton sinceLocalDate={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /not set up on this server/i,
    );
  });

  /**
   * The give-up deadline must be a real timer, not a `useEffect` dependency.
   * `useLatestDigest` answers `data: undefined` here — a run that never
   * actually produces a digest (a backend timeout or crash after the 202) —
   * so `waitingFor` never changes again after the click, and an effect keyed
   * on it would never re-run to notice the deadline has passed. A
   * `setTimeout` armed when polling starts does not have this problem: it
   * fires on its own clock regardless of whether anything else re-renders.
   *
   * This test must fail against an implementation that gives up inside a
   * dependency-driven `useEffect` — if it doesn't, it isn't testing the
   * thing it's meant to catch.
   */
  it("gives up two minutes after a digest never lands, and stops polling", () => {
    vi.useFakeTimers();
    try {
      render(<RunDigestButton sinceLocalDate={null} />);

      fireEvent.click(screen.getByRole("button", { name: /generate now/i }));
      expect(
        screen.getByRole("button", { name: /generating/i }),
      ).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(120_000);
      });

      const button = screen.getByRole("button", { name: /generate now/i });
      expect(button).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        /longer than expected/i,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Success is decided by comparing two server-issued values, never by
 * comparing a server timestamp to the browser's clock.
 *
 * The old test was `latest.data.generatedAt > new Date(startedAt).toISOString()`
 * where `startedAt = Date.now()` on the client. No NTP is the norm on a shop
 * counter PC in this market — the repo already ships a 366-day client-side
 * guard for adjacent reasons — and both directions of skew break it:
 *
 * - **fast clock**: the run completes and the server stamps its own time,
 *   which is behind the client's `startedAt`, so the comparison stays false.
 *   `InsightsScreen` and this button share a query key, so the new digest is
 *   already rendered above while the button still reads "Generating…" and then
 *   "This is taking longer than expected."
 * - **slow clock**: a pre-existing row for the same `localDate` (manual runs
 *   upsert, spec §5) satisfies the comparison on the first poll, so the button
 *   reports success before the run has produced anything.
 *
 * Capturing the identity of the digest on screen at click time and treating
 * "changed from that" as success removes the browser clock from the decision
 * entirely.
 */
describe("RunDigestButton — the run landed", () => {
  const clickGenerate = () =>
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

  it("ends the wait when the digest changes, with the counter clock ten minutes FAST", () => {
    vi.useFakeTimers();
    try {
      // The server will stamp 18:05:40Z; this machine thinks it is 18:14:00Z.
      vi.setSystemTime(new Date("2026-09-12T18:14:00.000Z"));
      latestData = {
        id: "d1",
        localDate: "2026-09-12",
        generatedAt: "2026-09-12T17:00:00.000Z",
      };

      const { rerender } = render(
        <RunDigestButton sinceLocalDate="2026-09-12" />,
      );
      clickGenerate();
      expect(
        screen.getByRole("button", { name: /generating/i }),
      ).toBeDisabled();

      // The run lands: a manual run upserts the same `localDate` row, so the
      // id is unchanged and only the server's own stamp moved.
      latestData = {
        id: "d1",
        localDate: "2026-09-12",
        generatedAt: "2026-09-12T18:05:40.000Z",
      };
      act(() => {
        rerender(<RunDigestButton sinceLocalDate="2026-09-12" />);
      });

      expect(
        screen.getByRole("button", { name: /generate again/i }),
      ).toBeEnabled();
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting on the digest that was already there, with the clock ten minutes SLOW", () => {
    vi.useFakeTimers();
    try {
      // This machine thinks it is 17:55Z; the row on screen was stamped
      // 18:05Z by the server. `generatedAt > startedAt` is true immediately.
      vi.setSystemTime(new Date("2026-09-12T17:55:00.000Z"));
      latestData = {
        id: "d1",
        localDate: "2026-09-12",
        generatedAt: "2026-09-12T18:05:00.000Z",
      };

      const { rerender } = render(
        <RunDigestButton sinceLocalDate="2026-09-12" />,
      );
      clickGenerate();

      // Poll once. Nothing new has been written.
      act(() => {
        rerender(<RunDigestButton sinceLocalDate="2026-09-12" />);
      });

      expect(
        screen.getByRole("button", { name: /generating/i }),
      ).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the wait on the first digest a shop has ever had", () => {
    latestData = undefined;
    const { rerender } = render(<RunDigestButton sinceLocalDate={null} />);
    clickGenerate();
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();

    latestData = {
      id: "d1",
      localDate: "2026-09-12",
      generatedAt: "2026-09-12T18:05:40.000Z",
    };
    act(() => {
      rerender(<RunDigestButton sinceLocalDate={null} />);
    });

    expect(screen.getByRole("button", { name: /generate/i })).toBeEnabled();
  });

  it("ignores a digest for a different day", () => {
    latestData = {
      id: "d0",
      localDate: "2026-09-11",
      generatedAt: "2026-09-11T18:05:00.000Z",
    };
    const { rerender } = render(
      <RunDigestButton sinceLocalDate="2026-09-11" />,
    );
    clickGenerate();

    // Yesterday's row is still the newest one the API knows about.
    act(() => {
      rerender(<RunDigestButton sinceLocalDate="2026-09-11" />);
    });

    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();
  });
});
