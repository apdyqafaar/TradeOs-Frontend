import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunDigestButton } from "./run-digest-button";

const mutate = vi.fn();
let error: { status: number; code: string; message: string } | null = null;

vi.mock("@/features/insights/hooks/use-digests", () => ({
  useRunDigest: () => ({ mutate, isPending: false, error }),
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
});
