import { describe, expect, it } from "vitest";
import { getInitials, resolveActiveHref } from "./nav-utils";

describe("resolveActiveHref", () => {
  const hrefs = [
    "/overview",
    "/sales",
    "/sales/new",
    "/products",
    "/team",
    "/team/roles",
  ];

  it("prefers the longest match so a child route does not light up its parent", () => {
    expect(resolveActiveHref("/sales/new", hrefs)).toBe("/sales/new");
    expect(resolveActiveHref("/team/roles", hrefs)).toBe("/team/roles");
  });

  it("marks the parent active for a detail route with no nav entry of its own", () => {
    expect(resolveActiveHref("/sales/64f0c9a2b1e4d5a6c7b8e9f0", hrefs)).toBe(
      "/sales",
    );
  });

  it("does not treat a shared prefix as a match", () => {
    expect(resolveActiveHref("/products-import", hrefs)).toBeNull();
  });

  it("returns null for an unknown route", () => {
    expect(resolveActiveHref("/nowhere", hrefs)).toBeNull();
  });
});

describe("getInitials", () => {
  it("takes the first letter of the first and last name", () => {
    expect(getInitials("Amina Mohamed")).toBe("AM");
  });

  it("handles a single name and empty input without throwing", () => {
    expect(getInitials("Amina")).toBe("A");
    expect(getInitials("")).toBe("");
  });
});
