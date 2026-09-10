import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { ListedMember } from "../types";
import { RemoveMemberDialog } from "./remove-member-dialog";

const mutate = vi.fn();
vi.mock("../hooks/use-member-mutations", () => ({
  useRemoveMember: () => ({ mutate, isPending: false }),
}));

const active: ListedMember = {
  id: "m1",
  status: "active",
  joinedAt: "2026-08-14T09:00:00.000Z",
  createdAt: "2026-08-10T09:00:00.000Z",
  user: { id: "u1", name: "Amina Yusuf", email: "amina@spark.co.ke" },
  role: { id: "r-seller", name: "Seller" },
};

const pending: ListedMember = {
  id: "m2",
  status: "invited",
  invitedEmail: "leyla@spark.co.ke",
  createdAt: "2026-09-02T09:00:00.000Z",
  user: null,
  role: { id: "r-seller", name: "Seller" },
};

const open = (member: ListedMember) =>
  render(<RemoveMemberDialog open onOpenChange={vi.fn()} member={member} />);

beforeEach(() => {
  mutate.mockReset();
});

describe("RemoveMemberDialog", () => {
  it("never says delete, because nothing is deleted", () => {
    // The row survives with `status: "removed"` and keeps its `userId`, so past
    // sales stay attributable. "Delete" would be wrong twice: nothing is
    // erased, and the person is not erased from the books either.
    open(active);

    expect(screen.getByText("Remove Amina Yusuf?")).toBeInTheDocument();
    expect(
      screen.getByText(/stay in the books under their name/i),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/delete/i);
  });

  it("says they are signed out everywhere, which is what actually happens", () => {
    // The removal revokes every session that user holds, synchronously — their
    // next request is a 401. Not mentioning it would make the effect a surprise.
    open(active);
    expect(
      screen.getByText(/signed out everywhere immediately/i),
    ).toBeInTheDocument();
  });

  it("becomes a cancel-invitation dialog for a pending row", () => {
    // Same endpoint, different story: no session to revoke, nothing to
    // attribute, and there is no separate cancel-invite route in the API.
    open(pending);

    expect(
      screen.getByText("Cancel the invitation to leyla@spark.co.ke?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel invitation" }),
    ).toBeInTheDocument();
  });

  it("shows the API's own words for a 403, which name the exact rule", async () => {
    // "You cannot remove yourself" and "The owner cannot be removed from their
    // own business" both arrive as FORBIDDEN and both say precisely what
    // happened. The menu already hides these cases; a role can change between
    // the render and the click, so the dialog explains rather than shrugs.
    const user = userEvent.setup();
    mutate.mockImplementation(
      (_id: string, handlers: { onError: (error: ApiError) => void }) => {
        handlers.onError(
          new ApiError({
            message: "You cannot remove yourself",
            status: 403,
            code: "FORBIDDEN",
          }),
        );
      },
    );
    open(active);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("You cannot remove yourself")).toBeInTheDocument();
  });

  it("explains a 409 as a stale screen rather than repeating the API", async () => {
    const user = userEvent.setup();
    mutate.mockImplementation(
      (_id: string, handlers: { onError: (error: ApiError) => void }) => {
        handlers.onError(
          new ApiError({
            message: "That member has already been removed",
            status: 409,
            code: "CONFLICT",
          }),
        );
      },
    );
    open(active);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/already been removed/i)).toBeInTheDocument();
  });
});
