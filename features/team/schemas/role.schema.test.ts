import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import {
  createRoleSchema,
  isReservedRoleName,
  permissionSet,
  updateRoleSchema,
} from "./role.schema";

const first = (result: {
  success: false;
  error: { issues: { message: string }[] };
}) => result.error.issues[0]?.message;

describe("createRoleSchema", () => {
  it("requires permissions — an omitted key is not an empty role", () => {
    // The MODEL defaults `permissions` to []; the VALIDATOR does not. Omitting
    // the key is a 422 on the server ("expected array, received undefined"),
    // so a form that leaves it out to mean "none" is broken.
    const result = createRoleSchema.safeParse({ name: "Stock clerk" });
    expect(result.success).toBe(false);
  });

  it("accepts an explicitly empty permissions array", () => {
    // A role that can do nothing is legal, and this is how you say it.
    const result = createRoleSchema.safeParse({
      name: "Observer",
      permissions: [],
    });
    expect(result.success).toBe(true);
  });

  it("trims the name and refuses one that is only whitespace", () => {
    const padded = createRoleSchema.safeParse({
      name: "  Stock clerk  ",
      permissions: [],
    });
    expect(padded.success && padded.data.name).toBe("Stock clerk");

    const blank = createRoleSchema.safeParse({ name: "   ", permissions: [] });
    expect(blank.success).toBe(false);
  });

  it("refuses the three reserved names in any casing", () => {
    // 409 `"<name>" is a built-in role name` on the server, checked after
    // trimming and case-folding. Catching it here puts the message on the field.
    for (const name of ["owner", "Manager", "  sElLeR "]) {
      expect(
        createRoleSchema.safeParse({ name, permissions: [] }).success,
      ).toBe(false);
    }
  });

  it("allows a name that merely starts with a reserved word", () => {
    // `isReservedRoleName("Ownerly")` is false on the backend too.
    expect(
      createRoleSchema.safeParse({ name: "Ownerly", permissions: [] }).success,
    ).toBe(true);
  });

  it("refuses the wildcard", () => {
    // `"*"` belongs to the Owner preset alone; granting it is a 422 on
    // `permissions.0`.
    const result = createRoleSchema.safeParse({
      name: "God mode",
      permissions: ["*"],
    });
    expect(result.success).toBe(false);
    expect(first(result as never)).toMatch(/wildcard/i);
  });

  it("refuses a permission that is not in the catalog", () => {
    const result = createRoleSchema.safeParse({
      name: "Teleporter",
      permissions: ["members:teleport"],
    });
    expect(result.success).toBe(false);
  });

  it("refuses duplicates, which the backend would silently accept", () => {
    // The backend does NOT de-duplicate: three copies of the same permission
    // are stored as three entries and count three times against the 43-item
    // cap. A UI that appends on every click would hit "Too big" long before 43
    // distinct permissions were chosen.
    const result = createRoleSchema.safeParse({
      name: "Clerk",
      permissions: ["members:view", "members:view"],
    });
    expect(result.success).toBe(false);
    expect(first(result as never)).toMatch(/twice/i);
  });

  it("accepts the entire catalog, which is exactly the cap", () => {
    const result = createRoleSchema.safeParse({
      name: "Almost owner",
      permissions: [...ALL_PERMISSIONS],
    });
    expect(result.success).toBe(true);
    expect(ALL_PERMISSIONS).toHaveLength(43);
  });
});

describe("updateRoleSchema", () => {
  it("refuses an empty patch, whose server error has no field to land on", () => {
    // The backend's 422 for this is filed under the key `_`, not a field name,
    // so a form mapping errors onto inputs would show nothing at all. Refusing
    // it here means that never happens.
    expect(updateRoleSchema.safeParse({}).success).toBe(false);
  });

  it("accepts any single field", () => {
    expect(updateRoleSchema.safeParse({ name: "New name" }).success).toBe(true);
    expect(updateRoleSchema.safeParse({ description: "" }).success).toBe(true);
    // Stripping a role bare is legal.
    expect(updateRoleSchema.safeParse({ permissions: [] }).success).toBe(true);
  });
});

describe("permissionSet", () => {
  it("de-duplicates and returns the catalog's own order", () => {
    // So two people ticking the same boxes in a different order send
    // byte-identical bodies.
    expect(
      permissionSet(["sales:create", "members:view", "sales:create"]),
    ).toEqual(["members:view", "sales:create"]);
  });

  it("drops anything not in the catalog", () => {
    expect(permissionSet(["members:view", "members:teleport", "*"])).toEqual([
      "members:view",
    ]);
  });

  it("gives an empty array for an empty selection, not undefined", () => {
    // Which is what makes "a role that can do nothing" sendable.
    expect(permissionSet([])).toEqual([]);
  });
});

describe("isReservedRoleName", () => {
  it("folds case and trims, exactly as the backend does", () => {
    expect(isReservedRoleName("  oWNer ")).toBe(true);
    expect(isReservedRoleName("Ownerly")).toBe(false);
  });
});
