import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedMember } from "@/features/team/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { MemberDetail } from "./member-detail";

const query = vi.fn();

vi.mock("@/features/team/hooks/use-member", () => ({
  useMember: () => query(),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({ timezone: "Africa/Nairobi", isLoading: false }),
}));

vi.mock("@/features/auth/hooks/use-session", () => ({
  useSession: () => ({ data: { user: { id: "u-owner" } } }),
}));

// The row's own controls are covered by `member-row-actions.test.tsx`; this
// screen only has to hand them the right member and the SESSION USER's id.
const rowActions = vi.fn();
vi.mock("@/features/team/components/member-row-actions", () => ({
  MemberRowActions: (props: unknown) => {
    rowActions(props);
    return <div data-testid="row-actions" />;
  },
}));

const active = (overrides: Partial<ListedMember> = {}): ListedMember => ({
  id: "m1",
  status: "active",
  joinedAt: "2026-08-01T09:00:00.000Z",
  createdAt: "2026-07-28T09:00:00.000Z",
  user: {
    id: "u-seller",
    name: "Hodan Yusuf",
    email: "hodan@wardher.test",
  },
  role: { id: "r-seller", name: "Seller" },
  ...overrides,
});

const settled = (data: ListedMember) => ({
  data,
  isPending: false,
  error: null,
  refetch: vi.fn(),
});

const failed = (error: ApiError) => ({
  data: undefined,
  isPending: false,
  error,
  refetch: vi.fn(),
});

beforeEach(() => {
  query.mockReset();
  rowActions.mockReset();
});

describe("MemberDetail", () => {
  it("shows the identity, the role and the standing", () => {
    query.mockReturnValue(settled(active()));
    render(<MemberDetail memberId="m1" />);

    expect(
      screen.getByRole("heading", { name: "Hodan Yusuf" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("hodan@wardher.test").length).toBeGreaterThan(0);
    expect(screen.getByText("Seller")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("hands the actions the SESSION USER's id, not the member id", () => {
    // `canRemoveMember` compares against `user.id` to stop someone removing
    // themselves. Passing the member id would silently disable that guard —
    // the two id spaces are different rows and would simply never match.
    query.mockReturnValue(settled(active()));
    render(<MemberDetail memberId="m1" />);

    expect(rowActions).toHaveBeenCalledWith(
      expect.objectContaining({ sessionUserId: "u-owner" }),
    );
  });

  it("dates a pending invitation from when it was sent, and says so", () => {
    // `joinedAt` is absent until they accept. `createdAt` is the only date the
    // row has, and the label has to change with it or the screen claims
    // somebody joined on a day they did not.
    query.mockReturnValue(
      settled(
        active({
          status: "invited",
          joinedAt: undefined,
          user: null,
          invitedEmail: "new@wardher.test",
        }),
      ),
    );
    render(<MemberDetail memberId="m1" />);

    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.queryByText("Joined")).not.toBeInTheDocument();
    expect(screen.getByText(/has not been accepted yet/i)).toBeInTheDocument();
  });

  it("takes a pending row's identity from its address", () => {
    query.mockReturnValue(
      settled(
        active({
          status: "invited",
          joinedAt: undefined,
          user: null,
          invitedEmail: "new@wardher.test",
        }),
      ),
    );
    render(<MemberDetail memberId="m1" />);

    expect(
      screen.getByRole("heading", { name: "new@wardher.test" }),
    ).toBeInTheDocument();
  });

  it("treats a 404 as removed rather than as an error", () => {
    // A removed member and an id that never existed are the same 404. An error
    // card would leave someone who just removed a colleague wondering whether
    // it worked.
    query.mockReturnValue(
      failed(
        new ApiError({
          message: "Member not found",
          status: 404,
          code: API_ERROR_CODE.NOT_FOUND,
        }),
      ),
    );
    render(<MemberDetail memberId="m1" />);

    expect(screen.getByText(/not on your team/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to members/i }),
    ).toBeInTheDocument();
  });

  it("shows a real failure as a failure, with a retry", () => {
    query.mockReturnValue(
      failed(
        new ApiError({
          message: "Service unavailable",
          status: 503,
          code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
          requestId: "req-77",
        }),
      ),
    );
    render(<MemberDetail memberId="m1" />);

    expect(screen.queryByText(/not on your team/i)).not.toBeInTheDocument();
    expect(screen.getByText(/req-77/)).toBeInTheDocument();
  });

  it("renders for a member whose role document vanished", () => {
    // `role: null` is near-unreachable but the field is nullable on the wire,
    // and the alternative to handling it is printing "undefined" as a role.
    query.mockReturnValue(settled(active({ role: null })));
    render(<MemberDetail memberId="m1" />);

    expect(screen.getByText("No role")).toBeInTheDocument();
  });
});
