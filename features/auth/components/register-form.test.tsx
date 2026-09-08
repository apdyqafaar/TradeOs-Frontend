import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckEmailPanel } from "./check-email-panel";
import { RegisterForm } from "./register-form";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-register", () => ({
  useRegister: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Task 8's unverified-email strip reuses this hook, so the panel is held to
// the same contract the strip will be: `mutate()` with no argument, and the
// 60-second lockout owned by the component rather than the hook.
const resend = vi.fn((_input?: undefined, opts?: { onSuccess?: () => void }) =>
  opts?.onSuccess?.(),
);
vi.mock("@/features/auth/hooks/use-resend-verification", () => ({
  useResendVerification: () => ({
    mutate: resend,
    isPending: false,
    error: null,
  }),
}));

beforeEach(() => {
  mutate.mockClear();
  resend.mockClear();
});

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("RegisterForm", () => {
  it("rejects a password under 8 characters, matching the backend rule", async () => {
    render(wrap(<RegisterForm onRegistered={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Amina Mohamed");
    await userEvent.type(
      screen.getByLabelText("Email"),
      "amina@sparktrading.co.ke",
    );
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );

    expect(await screen.findByText(/at least 8/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("CheckEmailPanel", () => {
  it("names the address the link was sent to", () => {
    render(<CheckEmailPanel email="amina@sparktrading.co.ke" />);
    expect(screen.getByText("amina@sparktrading.co.ke")).toBeInTheDocument();
  });

  it("locks Resend behind a countdown once a link goes out", async () => {
    render(<CheckEmailPanel email="amina@sparktrading.co.ke" />);
    await userEvent.click(screen.getByRole("button", { name: "Resend" }));

    expect(resend).toHaveBeenCalledOnce();
    const button = screen.getByRole("button", { name: "Resend in 60s" });
    expect(button).toBeDisabled();
  });
});
