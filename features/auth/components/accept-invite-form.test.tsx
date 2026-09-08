import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcceptInviteForm } from "./accept-invite-form";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-accept-invite", () => ({
  useAcceptInvite: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("AcceptInviteForm", () => {
  it("sends the token from the URL along with the typed details", async () => {
    render(wrap(<AcceptInviteForm token="inv_abc123" />));
    await userEvent.type(screen.getByLabelText("Your name"), "Yusuf Ali");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(
      screen.getByRole("button", { name: "Join the team" }),
    );

    expect(mutate).toHaveBeenCalledWith(
      { token: "inv_abc123", name: "Yusuf Ali", password: "secret123" },
      expect.anything(),
    );
  });
});
