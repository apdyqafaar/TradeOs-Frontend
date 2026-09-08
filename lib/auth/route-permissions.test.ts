import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { resolveRoutePermission } from "./route-permissions";

describe("resolveRoutePermission", () => {
  it("maps a top-level page to its permission", () => {
    expect(resolveRoutePermission("/reports")).toBe(PERMISSIONS.REPORTS_VIEW);
    expect(resolveRoutePermission("/products")).toBe(PERMISSIONS.PRODUCTS_VIEW);
  });

  it("gives a sub-route its own stricter permission, not its parent's", () => {
    // A Seller holds sales:view but not sales:void; they may open /sales but
    // must not reach /sales/new without sales:create.
    expect(resolveRoutePermission("/sales/new")).toBe(PERMISSIONS.SALES_CREATE);
    expect(resolveRoutePermission("/products/import")).toBe(
      PERMISSIONS.PRODUCTS_CREATE,
    );
    expect(resolveRoutePermission("/team/roles")).toBe(PERMISSIONS.ROLES_VIEW);
  });

  it("falls back to the parent's permission for a detail route", () => {
    expect(resolveRoutePermission("/products/64f0c9a2b1e4d5a6c7b8e9f0")).toBe(
      PERMISSIONS.PRODUCTS_VIEW,
    );
    expect(resolveRoutePermission("/reports/sales")).toBe(
      PERMISSIONS.REPORTS_VIEW,
    );
  });

  it("does not treat a shared prefix as a match", () => {
    expect(resolveRoutePermission("/products-import")).toBeNull();
  });

  it("returns null for pages everyone may see", () => {
    for (const path of ["/overview", "/announcements", "/help", "/account"]) {
      expect(resolveRoutePermission(path), path).toBeNull();
    }
  });
});
