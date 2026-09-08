import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";

const mutate = vi.fn((_input, opts?: { onSuccess?: () => void }) =>
  opts?.onSuccess?.(),
);
vi.mock("@/features/auth/hooks/use-forgot-password", () => ({
  useForgotPassword: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("ForgotPasswordForm", () => {
  it("shows the same neutral confirmation whether or not the address exists", async () => {
    render(wrap(<ForgotPasswordForm />));
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Send reset link" }),
    );

    // The API deliberately answers identically either way so the page cannot be
    // used to discover who has an account. The UI must not undo that.
    expect(
      await screen.findByText(/if that address exists/i),
    ).toBeInTheDocument();
  });
});
