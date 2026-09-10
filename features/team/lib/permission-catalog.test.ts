import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, WILDCARD } from "@/lib/auth/permissions";
import { MAX_SPECIALS, PERMISSION_GROUPS } from "./permission-catalog";

describe("permission catalog", () => {
  it("covers every catalog permission exactly once", () => {
    // The matrix is the only screen that claims to show what a role can do. A
    // permission missing from it is a checkbox nobody can tick, and one listed
    // twice is a body that fails the backend's <=43 cap after two clicks.
    const flattened = PERMISSION_GROUPS.flatMap((group) => group.all);

    expect(flattened).toHaveLength(ALL_PERMISSIONS.length);
    expect(new Set(flattened).size).toBe(ALL_PERMISSIONS.length);
    expect([...flattened].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("has 43 permissions in 13 groups, as the contract counted them", () => {
    // `docs/contracts/team.md` §11 counted both by running the backend module.
    // If either number moves, the mirror moved and this slice needs a look.
    expect(ALL_PERMISSIONS).toHaveLength(43);
    expect(PERMISSION_GROUPS).toHaveLength(13);
  });

  it("never contains the wildcard", () => {
    // `"*"` is the Owner preset's whole array and is refused by the create
    // validator with a 422 on `permissions.0`. It must never reach a checkbox.
    const flattened = PERMISSION_GROUPS.flatMap((group) => group.all);
    expect(flattened as string[]).not.toContain(WILDCARD);
  });

  it("keeps the catalog's own order rather than sorting", () => {
    expect(PERMISSION_GROUPS.map((group) => group.resource)).toEqual([
      "organization",
      "members",
      "roles",
      "customers",
      "products",
      "categories",
      "sales",
      "debts",
      "payments",
      "reports",
      "announcements",
      "projects",
      "uploads",
    ]);
  });

  it("routes the seven special actions out of the standard columns", () => {
    const specials = PERMISSION_GROUPS.flatMap((group) =>
      group.specials.map((special) => special.permission),
    );

    // The design's own list: "adjust stock, void, write off, invite, remove and
    // publish" — plus `payments:void`, which is a second void the note's prose
    // folds into one word.
    expect(specials).toEqual([
      "members:invite",
      "members:remove",
      "products:adjust_stock",
      "sales:void",
      "debts:write_off",
      "payments:void",
      "projects:publish",
    ]);
  });

  it("gives members two specials, which is why the design's single cell had to grow", () => {
    const members = PERMISSION_GROUPS.find(
      (group) => group.resource === "members",
    );

    expect(members?.specials.map((special) => special.label)).toEqual([
      "Invite",
      "Remove",
    ]);
    expect(MAX_SPECIALS).toBe(2);
  });

  it("leaves a standard column absent when the permission does not exist", () => {
    // Sparse, not false. `payments` has no `view`, and `uploads` has neither
    // `view` nor `delete` — `uploads:create` covers listing and deletion. The
    // matrix renders an absent cell differently from an unticked one.
    const payments = PERMISSION_GROUPS.find(
      (group) => group.resource === "payments",
    );
    expect(payments?.standard.view).toBeUndefined();
    expect(payments?.standard.create).toBe("payments:create");

    const uploads = PERMISSION_GROUPS.find(
      (group) => group.resource === "uploads",
    );
    expect(uploads?.standard).toEqual({ create: "uploads:create" });

    const reports = PERMISSION_GROUPS.find(
      (group) => group.resource === "reports",
    );
    expect(reports?.standard).toEqual({ view: "reports:view" });
  });

  it("humanises the snake_case action into a checkbox label", () => {
    const products = PERMISSION_GROUPS.find(
      (group) => group.resource === "products",
    );
    expect(products?.specials).toEqual([
      { permission: "products:adjust_stock", label: "Adjust stock" },
    ]);
  });
});
