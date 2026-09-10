import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ListedMember, Role } from "../types";
import { MemberTable } from "./member-table";

// Every permission held, so the table's own gating (owner, self, pending) is
// what these tests actually exercise rather than the permission check.
const can = vi.fn(() => true);
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => can(),
  usePermissions: () => [],
}));

const idle = () => ({ mutate: vi.fn(), isPending: false });
vi.mock("../hooks/use-member-mutations", () => ({
  useChangeMemberRole: () => idle(),
  useResendInvite: () => idle(),
  useRemoveMember: () => idle(),
}));

const SELLER: Role = {
  id: "r-seller",
  name: "Seller",
  permissions: [],
  isCustom: false,
  isPreset: true,
};

const member = (overrides: Partial<ListedMember> = {}): ListedMember => ({
  id: "m1",
  status: "active",
  joinedAt: "2026-08-14T09:00:00.000Z",
  createdAt: "2026-08-10T09:00:00.000Z",
  user: { id: "u1", name: "Amina Yusuf", email: "amina@spark.co.ke" },
  role: { id: "r-seller", name: "Seller" },
  ...overrides,
});

/** A pending invitation: `user` is an explicit null, there is no `joinedAt`. */
const pending = (): ListedMember =>
  member({
    id: "m2",
    status: "invited",
    invitedEmail: "leyla@spark.co.ke",
    user: null,
    joinedAt: undefined,
    createdAt: "2026-09-02T09:00:00.000Z",
  });

const props = {
  meta: { page: 1, limit: 25, total: 2, totalPages: 1 },
  assignableRoles: [SELLER],
  canUpdateRole: true,
  sessionUserId: "u1",
  timezone: "Africa/Nairobi",
  isLoading: false,
  isStale: false,
  emptyState: <p>Nobody here yet</p>,
  onPageChange: vi.fn(),
  onLimitChange: vi.fn(),
};

describe("MemberTable", () => {
  it("names an accepted member and shows their email underneath", () => {
    render(<MemberTable {...props} rows={[member()]} />);

    expect(screen.getByText("Amina Yusuf")).toBeInTheDocument();
    expect(screen.getByText("amina@spark.co.ke")).toBeInTheDocument();
  });

  it("identifies a pending member by their invited email, with no user object", () => {
    // `user` is null until the invitation is accepted, so `invitedEmail` is the
    // whole identity. It must not also be repeated on the second line.
    render(<MemberTable {...props} rows={[pending()]} />);

    const cells = screen.getAllByText("leyla@spark.co.ke");
    expect(cells).toHaveLength(1);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows when a pending invitation was sent instead of an empty Joined cell", () => {
    // A pending row has no `joinedAt` key at all, and the API exposes no expiry
    // — the 7-day TTL lives on a Verification document that never reaches the
    // wire. `createdAt` is the only date this row has, and a three-week-old
    // invitation is a fact worth seeing.
    render(<MemberTable {...props} rows={[pending()]} />);

    expect(screen.getByText(/^Invited /)).toBeInTheDocument();
  });

  it("marks the caller's own row", () => {
    // Matched on `user.id` — `GET /auth/me` returns no member id at all.
    render(<MemberTable {...props} rows={[member()]} />);
    expect(screen.getByText("(You)")).toBeInTheDocument();
  });

  it("has no Invited by column, because the field is not on the wire", () => {
    // `invitedBy` is stored and written on every invite, but no mapper emits it
    // and no populate fetches it. A column for it could only ever be empty.
    render(<MemberTable {...props} rows={[member()]} />);

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Member", "Role", "Status", "Joined", ""]);
  });

  it("offers no sortable column, because the endpoint has no sort parameter", () => {
    // `GET /members` takes `page` and `limit` under a `.strict()` schema and
    // always sorts oldest-first. Sorting the visible page client-side would
    // reorder 25 rows and lie about the other 200.
    render(<MemberTable {...props} rows={[member()]} />);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(within(header).queryByRole("button")).toBeNull();
    }
  });

  it("renders the owner's role as text rather than a control", () => {
    // Changing the owner's role is a 403 matched on `Organization.ownerId`. The
    // control is hidden, never disabled.
    render(
      <MemberTable
        {...props}
        rows={[member({ role: { id: "r-owner", name: "Owner" } })]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Change role/ })).toBeNull();
    expect(screen.getByText("The owner's role is fixed")).toBeInTheDocument();
  });

  it("renders the role as text when the caller cannot update it", () => {
    render(<MemberTable {...props} canUpdateRole={false} rows={[member()]} />);

    expect(screen.queryByRole("button", { name: /Change role/ })).toBeNull();
    expect(screen.getByText("Seller")).toBeInTheDocument();
  });

  it("renders the role as text when the role list could not be loaded", () => {
    // A custom role holding `members:invite` but not `roles:view` can stand on
    // this page. There is nothing to pick from, so the cell degrades instead of
    // opening an empty menu.
    render(<MemberTable {...props} assignableRoles={[]} rows={[member()]} />);

    expect(screen.queryByRole("button", { name: /Change role/ })).toBeNull();
  });

  it("offers a row menu for somebody the caller may act on", () => {
    // Rendered for another member. The trigger is a Button handed to base-ui
    // through the `render` prop — this repo is on base-ui, not Radix, so the
    // polymorphic prop is `render` and never `asChild`.
    render(
      <MemberTable {...props} sessionUserId="u-manager" rows={[member()]} />,
    );

    expect(
      screen.getByRole("button", { name: "Actions for Amina Yusuf" }),
    ).toBeInTheDocument();
  });

  it("renders no row menu at all when every action would be refused", () => {
    // The owner cannot be removed and their role cannot be changed, so the cell
    // is empty rather than a menu with nothing in it.
    render(
      <MemberTable
        {...props}
        sessionUserId="u-manager"
        rows={[member({ role: { id: "r-owner", name: "Owner" } })]}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });
});
