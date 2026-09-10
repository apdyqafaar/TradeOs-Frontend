import { describe, expect, it } from "vitest";
import type { Role } from "../types";
import { assignableRoles, isOwnerPreset } from "./role.service";

const role = (overrides: Partial<Role> = {}): Role => ({
  id: "r1",
  name: "Seller",
  permissions: ["sales:create"],
  isCustom: false,
  isPreset: true,
  ...overrides,
});

const OWNER = role({
  id: "r-owner",
  name: "Owner",
  permissions: ["*"],
});

const MANAGER = role({ id: "r-manager", name: "Manager" });
const SELLER = role({ id: "r-seller", name: "Seller" });
const CUSTOM = role({
  id: "r-clerk",
  name: "Stock clerk",
  isCustom: true,
  isPreset: false,
});

describe("assignableRoles", () => {
  it("removes the Owner preset and keeps every other preset", () => {
    // THE trap in the role picker. `GET /roles` returns Owner with
    // `isPreset: true` and `permissions: ["*"]`, and choosing it in an invite
    // or a role change is a **403, not a 422** — so it has to be filtered
    // client-side. Manager and Seller are presets too and are freely
    // assignable by anyone, so filtering on `isPreset` would be wrong.
    expect(assignableRoles([MANAGER, OWNER, SELLER, CUSTOM])).toEqual([
      MANAGER,
      SELLER,
      CUSTOM,
    ]);
  });

  it("preserves the server's order", () => {
    // Presets first (isCustom ascending), then custom roles alphabetically.
    // Re-sorting here would fight a sort the server already did.
    const ordered = assignableRoles([MANAGER, SELLER, CUSTOM]);
    expect(ordered.map((entry) => entry.name)).toEqual([
      "Manager",
      "Seller",
      "Stock clerk",
    ]);
  });

  it("copes with an empty list", () => {
    // What a caller without `roles:view` has: the query is never fired and the
    // picker degrades to plain text rather than an empty dropdown.
    expect(assignableRoles([])).toEqual([]);
  });
});

describe("isOwnerPreset", () => {
  it("needs both the preset flag and the name", () => {
    expect(isOwnerPreset(OWNER)).toBe(true);
    expect(isOwnerPreset(MANAGER)).toBe(false);
  });

  it("does not match a custom role that somehow claims the name", () => {
    // Unreachable through the API — `owner` is reserved and a custom role
    // named that is a 409 — but requiring both facts means this stays right if
    // either changes.
    expect(
      isOwnerPreset(role({ name: "Owner", isCustom: true, isPreset: false })),
    ).toBe(false);
  });
});
