import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwoFactorForm } from "./two-factor-form";

/**
 * The behaviour here is all timing and guards, none of which any other test
 * covers: it auto-submits, it must not submit twice on one completion, and it
 * has to notice a challenge lapsing without spending a request to find out.
 * The agent that built the form proved these with a throwaway spec it could
 * not commit; this is that spec, restored.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
}));

const mutate = vi.fn();
const read = vi.fn();
const forget = vi.fn();

vi.mock("@/features/auth/hooks/use-two-factor-challenge", () => ({
  useTwoFactorChallenge: () => ({ mutate, isPending: false, error: null }),
  readTwoFactorChallenge: () => read(),
  forgetTwoFactorChallenge: () => forget(),
}));

/** Five minutes out, the same window the backend gives a challenge. */
const live = () => ({
  challengeToken: "chal_abc123",
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
});

const typeCode = async (digits: string) => {
  const boxes = screen.getAllByRole("textbox");
  const first = boxes[0];
  if (!first) throw new Error("no code boxes rendered");
  first.focus();
  await userEvent.paste(digits);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TwoFactorForm", () => {
  it("submits on its own once the sixth digit lands", async () => {
    read.mockReturnValue(live());
    render(<TwoFactorForm />);

    await typeCode("123456");

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        { challengeToken: "chal_abc123", code: "123456" },
        expect.anything(),
      ),
    );
  });

  it("does not submit a partial code", async () => {
    read.mockReturnValue(live());
    render(<TwoFactorForm />);

    await typeCode("12345");

    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the expired panel, and asks the API for nothing, once the challenge has lapsed", async () => {
    // An authenticator app leaves this screen open for minutes at a time. The
    // token dies after five, and the form knows the deadline, so it says so
    // rather than spending a guess to be told 401.
    read.mockReturnValue({
      challengeToken: "chal_stale",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    render(<TwoFactorForm />);

    expect(
      await screen.findByRole("link", { name: "Sign in again" }),
    ).toBeInTheDocument();
    expect(forget).toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the expired panel when no challenge was ever parked", async () => {
    // The direct-URL case, and the one that caught a real bug: the login form
    // used to navigate here without storing the token at all.
    read.mockReturnValue(null);
    render(<TwoFactorForm />);

    expect(
      await screen.findByRole("link", { name: "Sign in again" }),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
