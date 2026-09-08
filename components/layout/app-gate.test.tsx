import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppGate } from "./app-gate";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
}));

const session = vi.fn();
vi.mock("@/features/auth/hooks/use-session", () => ({
  useSession: () => session(),
}));

const SHELL = <div data-testid="shell">the whole dashboard</div>;

const withOrganization = {
  isPending: false,
  data: {
    user: { id: "u1", name: "Amina", email: "a@b.co", emailVerified: true },
    organization: {
      id: "o1",
      name: "Spark",
      slug: "spark",
      timezone: "Africa/Nairobi",
    },
    role: { id: "r1", name: "Owner" },
    permissions: ["*"],
    twoFactorEnabled: false,
  },
};

describe("AppGate", () => {
  it("hides the shell entirely while the session is resolving", () => {
    // The bug this exists to stop: the shell used to paint - sidebar, topbar,
    // breadcrumb - with a hole where the page should be, and only then
    // redirect. Chrome for a business you may not belong to is a lie.
    session.mockReturnValue({ isPending: true, data: undefined });
    render(<AppGate>{SHELL}</AppGate>);

    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.getByText("Setting up your workspace…")).toBeInTheDocument();
  });

  it("hides the shell and routes to onboarding when the user has no business", () => {
    session.mockReturnValue({
      isPending: false,
      data: { ...withOrganization.data, organization: null },
    });
    render(<AppGate>{SHELL}</AppGate>);

    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.getByText("Setting up your workspace…")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/onboarding");
  });

  it("sends a signed-out visitor to login rather than rendering the shell", () => {
    // The proxy normally catches this; if the cookie expired mid-session it
    // does not, and a dashboard shell for nobody is the worst answer.
    session.mockReturnValue({ isPending: false, data: undefined });
    render(<AppGate>{SHELL}</AppGate>);

    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("renders the shell once the person is known to belong to a business", () => {
    session.mockReturnValue(withOrganization);
    render(<AppGate>{SHELL}</AppGate>);

    expect(screen.getByTestId("shell")).toBeInTheDocument();
    expect(
      screen.queryByText("Setting up your workspace…"),
    ).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
