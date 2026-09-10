import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const push = vi.fn();
/** Mutable so a test can put a `?next=` on the URL the form reads. */
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/features/auth/hooks/use-two-factor-challenge", () => ({
  rememberTwoFactorChallenge: vi.fn(),
}));

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-login", () => ({
  useLogin: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("LoginForm", () => {
  it("refuses to submit an invalid email and never calls the API", async () => {
    render(wrap(<LoginForm />));
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("submits valid credentials", async () => {
    render(wrap(<LoginForm />));
    await userEvent.type(
      screen.getByLabelText("Email"),
      "amina@sparktrading.co.ke",
    );
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mutate).toHaveBeenCalledWith(
      { email: "amina@sparktrading.co.ke", password: "secret123" },
      expect.anything(),
    );
  });
});

describe("LoginForm — where it sends you after signing in", () => {
  /** Signs in successfully, so `onSuccess` runs and `push` is called. */
  const signIn = async () => {
    mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: (r: unknown) => void }) =>
        options?.onSuccess?.({ twoFactorRequired: false }),
    );
    render(wrap(<LoginForm />));
    await userEvent.type(
      screen.getByLabelText("Email"),
      "amina@sparktrading.co.ke",
    );
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  };

  beforeEach(() => {
    push.mockClear();
    mutate.mockReset();
    searchParams = new URLSearchParams();
  });

  it("returns the caller to the internal page they were aiming at", async () => {
    searchParams = new URLSearchParams("next=%2Fsales%3Fpage%3D2");
    await signIn();
    expect(push).toHaveBeenCalledWith("/sales?page=2");
  });

  it("refuses a protocol-relative next and goes to the overview instead", async () => {
    // The open redirect. `//evil.example` has no scheme, so the browser
    // supplies this page's and navigates OFF this origin — immediately after
    // the user typed their password on a page they reached from the product's
    // own domain. That is the shape a credential-phishing link wants, and the
    // parameter sits in a URL anyone can compose and send.
    searchParams = new URLSearchParams("next=%2F%2Fevil.example");
    await signIn();
    expect(push).toHaveBeenCalledWith("/overview");
    expect(push).not.toHaveBeenCalledWith("//evil.example");
  });

  it("refuses the backslash form several browsers normalise to it", async () => {
    searchParams = new URLSearchParams("next=%2F%5Cevil.example");
    await signIn();
    expect(push).toHaveBeenCalledWith("/overview");
  });

  it("refuses an absolute URL", async () => {
    searchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fx");
    await signIn();
    expect(push).toHaveBeenCalledWith("/overview");
  });
});

describe("LoginForm — the two-factor branch", () => {
  it("parks the challenge token before navigating, or 2FA sign-in is impossible", async () => {
    // Regression guard. `POST /auth/login` sets NO cookie on the 2FA branch:
    // `challengeToken` exists only in that response body. It was dropped on
    // the floor once, and nothing caught it — no test, no typecheck, no lint,
    // just a 2FA account that could never finish signing in.
    const { rememberTwoFactorChallenge } = await import(
      "@/features/auth/hooks/use-two-factor-challenge"
    );
    const remember = vi.mocked(rememberTwoFactorChallenge);
    remember.mockClear();
    push.mockClear();

    mutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (r: unknown) => void }) =>
        opts?.onSuccess?.({
          twoFactorRequired: true,
          challengeToken: "chal_abc123",
          expiresAt: "2026-09-07T12:05:00.000Z",
        }),
    );

    render(wrap(<LoginForm />));
    await userEvent.type(
      screen.getByLabelText("Email"),
      "amina@sparktrading.co.ke",
    );
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({ challengeToken: "chal_abc123" }),
    );
    expect(push).toHaveBeenCalledWith("/login/2fa");
  });
});
