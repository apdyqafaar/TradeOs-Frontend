import { readdir, readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * `redirect()` throws in Next so the render unwinds. The mock keeps that
 * contract — a test that let it return would prove the opposite of what it
 * looks like it proves, since execution would fall through to the code the
 * redirect exists to prevent.
 */
class RedirectError extends Error {
  constructor(readonly target: string) {
    super(`REDIRECT:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectError(target);
  },
}));

const session = vi.fn();
const requestPath = vi.fn();
vi.mock("@/lib/auth/server-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/server-session")
  >("@/lib/auth/server-session");
  return {
    ...actual,
    readServerSession: () => session(),
    readRequestPath: () => requestPath(),
  };
});

const { requirePageAccess } = await import("@/lib/auth/require-page-access");

const owner = (permissions: string[] = ["*"]) => ({
  user: { id: "u1", name: "Amina", email: "a@x.test", emailVerified: true },
  organization: { id: "o1", name: "Bakaara", slug: "b", timezone: "UTC" },
  role: { id: "r1", name: "Owner" },
  permissions,
  twoFactorEnabled: false,
});

const caught = async (): Promise<string> => {
  try {
    await requirePageAccess();
  } catch (error) {
    if (error instanceof RedirectError) return error.target;
    throw error;
  }
  return "(did not redirect)";
};

beforeEach(() => {
  vi.clearAllMocks();
  requestPath.mockReturnValue("/products");
});

describe("requirePageAccess", () => {
  it("sends a caller with no session to /login, carrying where they aimed", async () => {
    requestPath.mockReturnValue("/sales?page=2");
    session.mockResolvedValue(null);

    expect(await caught()).toBe("/login?next=%2Fsales%3Fpage%3D2");
  });

  it("sends a signed-in caller with no business to /onboarding", async () => {
    session.mockResolvedValue({ ...owner(), organization: null });

    expect(await caught()).toBe("/onboarding");
  });

  it("lets an owner through and reports the permission as held", async () => {
    session.mockResolvedValue(owner());

    const access = await requirePageAccess();
    expect(access.permitted).toBe(true);
    expect(access.session.user.email).toBe("a@x.test");
  });

  it("reports a missing permission rather than redirecting", async () => {
    // The rule this repo settled on: a member who lacks one permission keeps
    // the shell and sees ForbiddenScreen inside it, so they can navigate
    // somewhere they are allowed. A redirect would strand them.
    requestPath.mockReturnValue("/products");
    session.mockResolvedValue(owner([PERMISSIONS.SALES_VIEW]));

    const access = await requirePageAccess();
    expect(access.permitted).toBe(false);
  });

  it("resolves the permission from the path, ignoring the query string", async () => {
    requestPath.mockReturnValue("/products?tab=categories&page=3");
    session.mockResolvedValue(owner([PERMISSIONS.PRODUCTS_VIEW]));

    expect((await requirePageAccess()).permitted).toBe(true);
  });

  it("applies a child route's stricter permission, not the parent's", async () => {
    // `/products/new` is `products:create`; a Seller holds `products:view` and
    // would otherwise reach a form whose every submit is a 403.
    requestPath.mockReturnValue("/products/new");
    session.mockResolvedValue(owner([PERMISSIONS.PRODUCTS_VIEW]));

    expect((await requirePageAccess()).permitted).toBe(false);
  });
});

describe("every protected page is guarded", () => {
  /**
   * The guard only works on pages that call it, and nothing about adding a new
   * `page.tsx` under `(app)` forces anyone to. This walks the directory so a
   * page added next month fails here instead of shipping unprotected — the
   * failure mode being that the layout still covers a full load, so an
   * unguarded page looks fine until someone navigates to it from inside the
   * shell.
   */
  it("calls requirePageAccess in every app/(app) page.tsx", async () => {
    const pages: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(full);
        else if (entry.name === "page.tsx") pages.push(full);
      }
    };
    await walk("app/(app)");

    expect(pages.length).toBeGreaterThan(0);

    const unguarded: string[] = [];
    for (const page of pages) {
      const source = await readFile(page, "utf8");
      if (!source.includes("requirePageAccess")) unguarded.push(page);
    }

    expect(unguarded).toEqual([]);
  });
});
