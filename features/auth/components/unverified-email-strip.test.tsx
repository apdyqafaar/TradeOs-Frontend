import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnverifiedEmailStrip } from "./unverified-email-strip";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-resend-verification", () => ({
  useResendVerification: () => ({ mutate, isPending: false }),
}));

describe("UnverifiedEmailStrip", () => {
  it("resends the verification email when the action is clicked", async () => {
    render(<UnverifiedEmailStrip />);
    await userEvent.click(
      screen.getByRole("button", { name: "Resend verification" }),
    );
    expect(mutate).toHaveBeenCalledOnce();
  });
});
