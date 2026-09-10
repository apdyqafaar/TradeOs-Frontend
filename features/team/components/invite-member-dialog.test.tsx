import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Role } from "../types";
import { InviteMemberDialog } from "./invite-member-dialog";

const mutate = vi.fn();
vi.mock("../hooks/use-member-mutations", () => ({
  useInviteMember: () => ({ mutate, isPending: false }),
}));

const SELLER: Role = {
  id: "68c1f0a4e2b9c7d3a1f40b02",
  name: "Seller",
  description: "Sells at the counter",
  permissions: ["sales:create"],
  isCustom: false,
  isPreset: true,
};

/** Fire the dialog's `onError` with a given failure. */
const rejectWith = (error: ApiError) => {
  mutate.mockImplementation(
    (_input: unknown, handlers: { onError: (error: ApiError) => void }) => {
      handlers.onError(error);
    },
  );
};

const open = () =>
  render(
    <InviteMemberDialog
      open
      onOpenChange={vi.fn()}
      roles={[SELLER]}
      rolesLoading={false}
    />,
  );

const fillAndSubmit = async (email: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.selectOptions(screen.getByLabelText("Role"), SELLER.id);
  await user.click(screen.getByRole("button", { name: "Send invite" }));
};

beforeEach(() => {
  mutate.mockReset();
});

describe("InviteMemberDialog", () => {
  it("tells an unverified caller to check their own inbox, not to ask an owner", async () => {
    // THE branch that must be on `code`. `EMAIL_NOT_VERIFIED` is a 403 the
    // person can clear entirely themselves, and it is a completely normal state
    // for a brand-new owner. Reading it as an ordinary permission failure would
    // send them to ask somebody for access they already have.
    rejectWith(
      new ApiError({
        message:
          "Confirm your email address before doing this. Check your inbox for the link, or request a new one.",
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
      }),
    );
    open();
    await fillAndSubmit("leyla@spark.co.ke");

    expect(
      screen.getByText("Confirm your email address first"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ask an owner/i)).toBeNull();
  });

  it("shows a self-invite 409 verbatim", async () => {
    // The API's wording is already the clearest available and is refused before
    // any write or mail, so there is nothing to add.
    rejectWith(
      new ApiError({
        message: "You are already a member of this business",
        status: 409,
        code: "CONFLICT",
      }),
    );
    open();
    await fillAndSubmit("me@spark.co.ke");

    expect(
      screen.getByText("You are already a member of this business"),
    ).toBeInTheDocument();
  });

  it("adds the missing context to a 429: the quota belongs to the business", async () => {
    // The bucket is keyed on the organization, shared between inviting and
    // resending, and spent by every member. Somebody else's invitations can
    // exhaust it, which the server's message alone does not say.
    rejectWith(
      new ApiError({
        message: "Too many attempts. Try again in 900 seconds.",
        status: 429,
        code: "TOO_MANY_REQUESTS",
      }),
    );
    open();
    await fillAndSubmit("leyla@spark.co.ke");

    expect(
      screen.getByText(/shared across everyone in the business/i),
    ).toBeInTheDocument();
  });

  it("puts a 422 on the field the API named", async () => {
    rejectWith(
      new ApiError({
        message: "Validation failed",
        status: 422,
        code: "VALIDATION_ERROR",
        fieldErrors: { email: "Enter a valid email address" },
      }),
    );
    open();
    await fillAndSubmit("leyla@spark.co.ke");

    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("asks for a role in words, not in id format, before spending a request", async () => {
    // The schema's own message for a missing `roleId` names a 24-hex string,
    // which means nothing to somebody who has not opened the dropdown.
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("Email"), "leyla@spark.co.ke");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(screen.getByText("Pick a role for them")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("lowercases the address on the way out, exactly as the API does", async () => {
    // The backend schema lowercases before anything else touches it, and the
    // self-invite comparison is case-insensitive. Matching here means the value
    // sent is the value stored.
    mutate.mockImplementation(() => {});
    open();
    await fillAndSubmit("Leyla@Spark.CO.KE");

    expect(mutate).toHaveBeenCalledWith(
      { email: "leyla@spark.co.ke", roleId: SELLER.id },
      expect.anything(),
    );
  });

  it("says why Owner is not in the list", async () => {
    // Owner is filtered out upstream because assigning it is a 403, not a 422.
    // Silently omitting it would leave somebody hunting for it.
    open();
    expect(
      screen.getByText(/Owner cannot be given to anyone/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Owner" })).toBeNull();
  });

  it("describes the selected role from the wire, not from hardcoded copy", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Role"), SELLER.id);

    expect(screen.getByText("Sells at the counter")).toBeInTheDocument();
  });
});
