import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "./onboarding-wizard";

const mutate = vi.fn();
vi.mock("@/features/organization/hooks/use-create-organization", () => ({
  useCreateOrganization: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("OnboardingWizard", () => {
  it("will not advance past step one without a business name", async () => {
    render(wrap(<OnboardingWizard emailVerified />));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText(/business name is required/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Main currency")).not.toBeInTheDocument();
  });

  it("blocks creation entirely when the email is unverified", () => {
    render(wrap(<OnboardingWizard emailVerified={false} />));
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("advances to the currency step once the business is named", async () => {
    render(wrap(<OnboardingWizard emailVerified />));
    await userEvent.type(
      screen.getByLabelText("Business name"),
      "Spark Trading Ltd",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByLabelText("Main currency")).toBeInTheDocument();
    // Nothing is sent until the last step: `POST /organizations` has no
    // partial create, so a per-step submit would have nowhere to go.
    expect(mutate).not.toHaveBeenCalled();
  });

  it("spells the rate out in the direction the backend stores it", async () => {
    render(wrap(<OnboardingWizard emailVerified />));
    await userEvent.type(
      screen.getByLabelText("Business name"),
      "Spark Trading Ltd",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.type(await screen.findByLabelText("Main currency"), "KES");
    await userEvent.type(screen.getByLabelText("Exchange currency"), "USD");
    await userEvent.type(screen.getByLabelText("Exchange rate"), "130");

    // `exchangeRate` is units of MAIN per one unit of EXCHANGE
    // (`Backend/src/lib/money.ts`, `toMain` multiplies). Reading the sentence
    // the other way round is the mistake this asserts against: it would put
    // every foreign payment out by a factor of the rate squared.
    expect(await screen.findByText("1 USD = 130 KES")).toBeInTheDocument();
  });
});
