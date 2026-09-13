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
