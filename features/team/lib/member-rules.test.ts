import { describe, expect, it } from "vitest";
import type { ListedMember } from "../types";
import {
  canChangeRoleOf,
  canRemoveMember,
  isOwnerMember,
  isPendingMember,
  isSelfMember,
  memberInitials,
  memberPrimaryLabel,
  memberSecondaryLabel,
} from "./member-rules";

const member = (overrides: Partial<ListedMember> = {}): ListedMember => ({
  id: "m1",
  status: "active",
  joinedAt: "2026-08-01T09:00:00.000Z",
  createdAt: "2026-07-28T09:00:00.000Z",
  user: { id: "u1", name: "Amina Yusuf", email: "amina@spark.co.ke" },
  role: { id: "r-seller", name: "Seller" },
  ...overrides,
});

const owner = () =>
  member({ id: "m-owner", role: { id: "r-owner", name: "Owner" } });

/** A pending invitation: explicit `user: null`, no `joinedAt`. */
const pending = () =>
  member({
    id: "m-pending",
    status: "invited",
    invitedEmail: "leyla@spark.co.ke",
    user: null,
    joinedAt: undefined,
  });

describe("isOwnerMember", () => {
  it("identifies the owner by their role name", () => {
    // `Organization.ownerId` is not on the wire anywhere, so the role is the
    // only signal. It is a sound one: the Owner preset cannot be assigned to
    // anybody (403), a custom role can never be named "owner" (409, reserved),
    // and the owner's row is created holding it. Exactly one member per
    // business can be in this state.
    expect(isOwnerMember(owner())).toBe(true);
    expect(isOwnerMember(member())).toBe(false);
  });

  it("matches case-insensitively and after trimming, as the reserved check does", () => {
    expect(isOwnerMember(member({ role: { id: "r", name: "  OWNER " } }))).toBe(
      true,
    );
  });

  it("does not match a role that merely starts with owner", () => {
    // The backend's `isReservedRoleName("Ownerly")` is false, so a business can
    // genuinely have a role called that and it must not be treated as the owner.
    expect(isOwnerMember(member({ role: { id: "r", name: "Ownerly" } }))).toBe(
      false,
    );
  });

  it("treats a null role as not the owner", () => {
    expect(isOwnerMember(member({ role: null }))).toBe(false);
  });
});

describe("isSelfMember", () => {
  it("matches on user.id, because there is no member id in the session", () => {
    // `GET /auth/me` returns `user`, `organization`, `role` and `permissions` —
    // no member id — so the only comparable identity is the user's.
    expect(isSelfMember(member(), "u1")).toBe(true);
    expect(isSelfMember(member(), "u2")).toBe(false);
  });

  it("is never true for a pending row, which has no user at all", () => {
    expect(isSelfMember(pending(), "u1")).toBe(false);
  });

  it("is false while the session is still loading", () => {
    expect(isSelfMember(member(), undefined)).toBe(false);
  });
});

describe("canChangeRoleOf", () => {
  it("refuses only the owner", () => {
    expect(canChangeRoleOf(owner())).toBe(false);
    expect(canChangeRoleOf(member())).toBe(true);
  });

  it("allows a member to change their own role, because the API does", () => {
    // There is NO self-check on PATCH /members/:id. A manager holding
    // `members:update` really can demote themselves — the guards are "not the
    // owner" and "not to Owner", and nothing else. Hiding the control here
    // would be inventing a rule the server does not have.
    expect(canChangeRoleOf(member())).toBe(true);
  });
});

describe("canRemoveMember", () => {
  it("refuses the owner and refuses you", () => {
    expect(canRemoveMember(owner(), "u-someone")).toBe(false);
    expect(canRemoveMember(member(), "u1")).toBe(false);
  });

  it("allows removing anybody else", () => {
    expect(canRemoveMember(member(), "u-manager")).toBe(true);
  });

  it("allows cancelling a pending invitation", () => {
    // Cancelling is the same DELETE. An invited row has no `userId`, so the
    // "you cannot remove yourself" guard can never fire for it.
    expect(canRemoveMember(pending(), "u1")).toBe(true);
  });
});

describe("labels", () => {
  it("names an accepted member and puts their email underneath", () => {
    expect(memberPrimaryLabel(member())).toBe("Amina Yusuf");
    expect(memberSecondaryLabel(member())).toBe("amina@spark.co.ke");
  });

  it("uses the invited address as the whole identity of a pending row", () => {
    // No `User` document exists yet, so there is nothing else to show — and the
    // address must not be repeated on the second line.
    expect(memberPrimaryLabel(pending())).toBe("leyla@spark.co.ke");
    expect(memberSecondaryLabel(pending())).toBeNull();
  });

  it("prefers the real name for a re-invited former member, who has both", () => {
    // Their row was updated in place and kept its userId, so it is `invited`
    // WITH a populated user. `status === "invited"` does not imply no user.
    const returning = member({
      status: "invited",
      invitedEmail: "amina@spark.co.ke",
      joinedAt: undefined,
    });
    expect(memberPrimaryLabel(returning)).toBe("Amina Yusuf");
  });
});

describe("memberInitials", () => {
  it("takes the first letter of the first two words of a name", () => {
    expect(memberInitials(member())).toBe("AY");
  });

  it("builds initials from an email when that is all there is", () => {
    // Splitting on @ . _ - too, so a pending row gets "LS" from
    // leyla@spark.co.ke rather than "L@" or an empty circle.
    expect(memberInitials(pending())).toBe("LS");
  });

  it("falls back to two letters for a single-word identity", () => {
    expect(
      memberInitials(
        member({ user: { id: "u", name: "Cher", email: "c@x.y" } }),
      ),
    ).toBe("CH");
  });

  it("survives an identity with no letters in it", () => {
    expect(
      memberInitials(
        member({ user: { id: "u", name: "!!!", email: "x@y.z" } }),
      ),
    ).toBe("?");
  });
});

describe("isPendingMember", () => {
  it("is the resend guard: only an invited row accepts one", () => {
    // Resending to anyone who is not `invited` is a 409, including a removed
    // member — same branch on the server.
    expect(isPendingMember(pending())).toBe(true);
    expect(isPendingMember(member())).toBe(false);
  });
});
