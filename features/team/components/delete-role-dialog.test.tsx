import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Role } from "../types";
import { DeleteRoleDialog } from "./delete-role-dialog";

const mutate = vi.fn();
vi.mock("../hooks/use-role-mutations", () => ({
  useDeleteRole: () => ({ mutate, isPending: false }),
}));

const CLERK: Role = {
  id: "r-clerk",
  name: "Stock clerk",
  permissions: ["products:adjust_stock"],
  isCustom: true,
  isPreset: false,
};

const open = (memberCount: number | undefined) =>
  render(
    <DeleteRoleDialog
      open
      onOpenChange={vi.fn()}
      role={CLERK}
      memberCount={memberCount}
    />,
  );

beforeEach(() => {
  mutate.mockReset();
});

describe("DeleteRoleDialog", () => {
  it("does not offer a delete button while anybody holds the role", async () => {
    // The server refuses with a 409 whose message names the count, and there is
    // NO cascade and no reassignment — the only way through is to move those
    // members first. A button whose only outcome is that refusal is worse than
    // no button.
    open(2);

    expect(screen.queryByRole("button", { name: "Delete role" })).toBeNull();
    expect(
      screen.getByText(/2 members still have this role/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Move them all to another role/i),
    ).toBeInTheDocument();
  });

  it("says it in the singular for one member", () => {
    open(1);
    expect(
      screen.getByText(/1 member still has this role/i),
    ).toBeInTheDocument();
  });

  it("offers the delete when nobody holds the role", async () => {
    const user = userEvent.setup();
    open(0);

    await user.click(screen.getByRole("button", { name: "Delete role" }));
    expect(mutate).toHaveBeenCalledWith(CLERK.id, expect.anything());
  });

  it("offers the delete when the count is unknown and lets the server decide", async () => {
    // `undefined` means the members directory failed — most likely a 403 from a
    // role without `members:view`. Blocking on a number we do not have would
    // make the screen useless for exactly the person who can act.
    const user = userEvent.setup();
    open(undefined);

    await user.click(screen.getByRole("button", { name: "Delete role" }));
    expect(mutate).toHaveBeenCalled();
  });

  it("shows the server's 409 verbatim, because it names the live count", async () => {
    // The count on screen is derived from the members list; somebody else can
    // assign the role between the render and the click. The server's message is
    // computed at the moment of the attempt, so it wins.
    const user = userEvent.setup();
    mutate.mockImplementation(
      (_id: string, handlers: { onError: (error: ApiError) => void }) => {
        handlers.onError(
          new ApiError({
            message:
              "This role cannot be deleted: 1 member still has it. Move them to another role first.",
            status: 409,
            code: "CONFLICT",
          }),
        );
      },
    );
    open(0);

    await user.click(screen.getByRole("button", { name: "Delete role" }));
    expect(
      screen.getByText(
        /1 member still has it\. Move them to another role first\./,
      ),
    ).toBeInTheDocument();
  });

  it("says the deletion is permanent, unlike removing a member", () => {
    // The two DELETEs in this slice do opposite things. This one really removes
    // the document; `DELETE /members/:id` keeps the row and flips its status.
    open(0);
    expect(screen.getByText(/cannot be brought back/i)).toBeInTheDocument();
  });
});
