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
let error: { status: number; code: string; message: string } | null = null;

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useRunDigest: () => ({ mutate, isPending: false, error }),
  // Always `undefined`: the polling/give-up test wants a digest that never
  // lands, so every "poll" keeps returning the same (non-)answer.
  useLatestDigest: () => ({ data: undefined }),
}));

beforeEach(() => {
  mutate.mockClear();
  error = null;
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

  it("a 429 says the daily limit was reached, where the click happened", () => {
    error = { status: 429, code: "TOO_MANY_REQUESTS", message: "Too many" };
    render(<RunDigestButton sinceLocalDate="2026-09-12" />);
    expect(screen.getByRole("status")).toHaveTextContent(/three manual runs/i);
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
   * `useLatestDigest` is mocked to always return `data: undefined` — a run
   * that never actually produces a digest (a backend timeout or crash after
   * the 202) — so `waitingFor`/`startedAt` never change again after the
   * click, and an effect keyed on them would never re-run to notice the
   * deadline has passed. A `setTimeout` armed when polling starts does not
   * have this problem: it fires on its own clock regardless of whether
   * anything else re-renders.
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
