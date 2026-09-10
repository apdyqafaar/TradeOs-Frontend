import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/features/auth/services/auth.service";
import { DeleteAccountPanel } from "./delete-account-panel";

const session = vi.fn();
vi.mock("@/features/auth/hooks/use-session", () => ({
  useSession: () => session(),
}));

const mutate = vi.fn();
vi.mock("@/features/account/hooks/use-account-mutations", () => ({
  useDeleteAccount: () => ({ mutate, isPending: false, reset: vi.fn() }),
}));

const sessionWithRole = (roleName: string | null): SessionData => ({
  user: {
    id: "u1",
    name: "Amina",
    email: "amina@sparktrading.co.ke",
    emailVerified: true,
  },
  organization: {
    id: "o1",
    name: "Spark Trading Ltd",
    slug: "spark-trading-ltd",
    timezone: "Africa/Nairobi",
  },
  role: roleName === null ? null : { id: "r1", name: roleName },
  permissions: ["*"],
  twoFactorEnabled: false,
});

beforeEach(() => {
  session.mockReset();
  mutate.mockReset();
});

/**
 * The rule this panel exists to encode: **an organization owner can never
 * delete their own account**, because `DELETE /auth/account` answers 409
 * `OWNS_ORGANIZATION` while `countOrganizationsOwnedBy > 0` and there is no
 * ownership-transfer endpoint anywhere in the API to clear it with.
 *
 * The contract is explicit that the UI must say so rather than showing a
 * button that always refuses (§7, §11.8), and the API's own test proves the
 * refusal changes nothing at all — user, credentials, session and membership
 * are re-asserted intact afterwards. So nothing is lost by not offering it, and
 * a person is spared typing their password to be told no.
 */
describe("DeleteAccountPanel", () => {
  it("offers no delete control to an owner, and says why", () => {
    session.mockReturnValue({ data: sessionWithRole("Owner") });
    render(<DeleteAccountPanel />);

    expect(
      screen.queryByRole("button", { name: /delete account/i }),
    ).toBeNull();
    expect(
      screen.getByText(
        /you own this business, so your account cannot be deleted/i,
      ),
    ).toBeInTheDocument();
    // And it must not promise a transfer flow, because none exists.
    expect(
      screen.getByText(/no way to hand a business to another member yet/i),
    ).toBeInTheDocument();
  });

  it("offers the delete to a member who owns nothing", () => {
    session.mockReturnValue({ data: sessionWithRole("Manager") });
    render(<DeleteAccountPanel />);

    expect(
      screen.getByRole("button", { name: /delete account/i }),
    ).toBeInTheDocument();
  });

  it("does not promise a retention window, because the delete is hard", () => {
    // The email is immediately re-registerable (`account.test.ts:446-467`), so
    // "we keep your data for 30 days" would be a straight lie.
    session.mockReturnValue({ data: sessionWithRole("Seller") });
    render(<DeleteAccountPanel />);

    expect(
      screen.getByText(/becomes free to register again straight away/i),
    ).toBeInTheDocument();
  });

  it("treats a member with no role at all as a non-owner", () => {
    // `role` is null for someone mid-onboarding. They own nothing, so the API
    // would let them through.
    session.mockReturnValue({ data: sessionWithRole(null) });
    render(<DeleteAccountPanel />);

    expect(
      screen.getByRole("button", { name: /delete account/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing until the session is known", () => {
    session.mockReturnValue({ data: undefined });
    const { container } = render(<DeleteAccountPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
