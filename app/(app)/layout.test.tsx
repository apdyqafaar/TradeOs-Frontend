import { existsSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteGuard } from "@/components/layout/route-guard";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import type { SessionData } from "@/features/auth/services/auth.service";
import { REQUEST_PATH_HEADER } from "@/lib/auth/request-path-header";

/**
 * The layout's *decision*, not its markup.
 *
 * Mounting the shell would prove nothing about what this file is for: the
 * question is what a request gets before anything renders — a redirect, a
 * refusal, or the page. So each test drives `AppLayout` directly with a
 * request-shaped world (a cookie jar, a path header, an API) and asserts the
 * answer. `redirect` throws here exactly as the real one does, because a mock
 * that returned would let the layout run on past a decision it had made.
 */
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

const { cookieGet, headerGet } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  headerGet: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  // `RouteGuard` imports this. Nothing here renders it, but the module loads.
  usePathname: () => "/overview",
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
  headers: () => Promise.resolve({ get: headerGet }),
}));

const AppLayout = (await import("./layout")).default;

const SESSION: SessionData = {
  user: { id: "u1", name: "Amina", email: "a@b.co", emailVerified: true },
  organization: {
    id: "o1",
    name: "Spark",
    slug: "spark",
    timezone: "Africa/Nairobi",
  },
  role: { id: "r1", name: "Seller" },
  permissions: ["sales:view", "products:view"],
  twoFactorEnabled: false,
};

/** The API answered. Only `ok`, `status` and `json` are ever read. */
const apiReplies = (status: number, body?: unknown): void => {
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
};

/** A signed-in caller the API vouches for. */
const apiSays = (session: Partial<SessionData>): void =>
  apiReplies(200, {
    success: true,
    message: "Current session",
    data: { ...SESSION, ...session },
  });

const onPath = (path: string): void => {
  headerGet.mockImplementation((name: string) =>
    name === REQUEST_PATH_HEADER ? path : null,
  );
};

const withCookie = (value = "a-real-looking-token"): void => {
  cookieGet.mockReturnValue({ name: "tradeos_session", value });
};

const renderLayout = (): Promise<ReactNode> =>
  AppLayout({ children: <div data-testid="page">the page</div> });

/** Does the tree the layout returned contain this component anywhere? */
function contains(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, type));
  if (!isValidElement(node)) return false;
  if (node.type === type) return true;
  const { children } = node.props as { children?: ReactNode };
  return contains(children, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  cookieGet.mockReturnValue(undefined);
  onPath("/overview");
});

describe("the (app) layout's server-side gate", () => {
  it("sends a caller with no session cookie to /login without asking the API", async () => {
    onPath("/sales");

    await expect(renderLayout()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsales",
    );
    // There is nothing to validate, so nothing is validated. A round trip per
    // anonymous request would be a free amplification target.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a caller whose cookie the API rejects to /login", async () => {
    // THE BUG THIS FILE EXISTS FOR. `document.cookie =
    // "tradeos_session=anything"` satisfies proxy.ts, which only checks that
    // the cookie is present. Before this gate the shell rendered for that
    // request and a client component bounced them afterwards.
    withCookie("forged");
    onPath("/sales");
    apiReplies(401, { success: false, message: "Not signed in" });

    await expect(renderLayout()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsales",
    );
  });

  it("sends a caller the API forbids to /login", async () => {
    withCookie();
    apiReplies(403, { success: false, message: "Forbidden" });

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends an authenticated user with no organization to /onboarding", async () => {
    withCookie();
    apiSays({ organization: null, role: null, permissions: [] });

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("refuses a page the caller lacks the permission for, inside the shell", async () => {
    // A Seller typing /reports. Not a redirect: they are a real member who
    // took a wrong turn, and the shell is their way back out.
    withCookie();
    onPath("/reports");
    apiSays({});

    const tree = await renderLayout();

    expect(contains(tree, ForbiddenScreen)).toBe(true);
    expect(contains(tree, RouteGuard)).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders the page for a valid session that holds the permission", async () => {
    withCookie();
    onPath("/sales");
    apiSays({});

    const tree = await renderLayout();

    expect(contains(tree, RouteGuard)).toBe(true);
    expect(contains(tree, ForbiddenScreen)).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders a page that no ROUTE_PERMISSIONS row gates", async () => {
    withCookie();
    onPath("/overview");
    apiSays({ permissions: [] });

    expect(contains(await renderLayout(), RouteGuard)).toBe(true);
  });

  it("treats the owner wildcard as holding every permission", async () => {
    withCookie();
    onPath("/settings");
    apiSays({ permissions: ["*"] });

    expect(contains(await renderLayout(), RouteGuard)).toBe(true);
  });
});

describe("what the gate asks the API", () => {
  it("calls /auth/me on the API origin, uncached, with the session cookie", async () => {
    withCookie("token-123");
    apiSays({});
    await renderLayout();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    // Straight to Express, not through `lib/api/client.ts` — that instance is
    // browser-shaped and its 401 interceptor calls `window.location.assign`.
    expect(url).toBe("http://localhost:8001/api/v1/auth/me");
    // Per-request, per-user auth. A cached answer is one person's identity
    // handed to the next.
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>).cookie).toBe(
      "tradeos_session=token-123",
    );
  });
});

describe("failing closed", () => {
  it("treats an unreachable API as unauthenticated", async () => {
    // A backend that is down must not become a way in.
    withCookie();
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("treats a 500 as unauthenticated", async () => {
    withCookie();
    apiReplies(500, { success: false, message: "boom" });

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("treats a 200 that is not a session as unauthenticated", async () => {
    // An HTML error page from a proxy, or a backend mid-deploy. A 200 is not a
    // licence to render the shell.
    withCookie();
    apiReplies(200, { success: true, message: "ok", data: { hello: "world" } });

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("treats an unparseable body as unauthenticated", async () => {
    withCookie();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    } as unknown as Response);

    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the path the proxy hands over", () => {
  it("carries the query string into next=, so the caller lands where they aimed", async () => {
    onPath("/sales?page=2&status=paid");

    await expect(renderLayout()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsales%3Fpage%3D2%26status%3Dpaid",
    );
  });

  it("resolves the permission from the path alone, ignoring the query", async () => {
    withCookie();
    onPath("/reports?period=month");
    apiSays({});

    expect(contains(await renderLayout(), ForbiddenScreen)).toBe(true);
  });

  it("ignores a path that would leave the origin", async () => {
    // The proxy overwrites this header on every matched request so a forged
    // one cannot arrive, but the value ends up in a `next=` that
    // `login-form.tsx` pushes onto the router unvalidated.
    onPath("//evil.example");

    await expect(renderLayout()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Foverview",
    );
  });

  it("falls back to /overview when the header is missing entirely", async () => {
    // Not `/` — that resolves to "no permission required", which is the wrong
    // direction to fail in.
    headerGet.mockReturnValue(null);
    withCookie();
    apiSays({ permissions: [] });

    expect(contains(await renderLayout(), RouteGuard)).toBe(true);
  });
});

describe("what this gate must not catch", () => {
  it("does not cover /onboarding, which lives outside the (app) group", () => {
    // The no-organization redirect above points at /onboarding. If that page
    // were inside this group the redirect would loop forever, so the location
    // is load-bearing and is asserted rather than assumed.
    expect(
      existsSync(join(process.cwd(), "app/(auth)/onboarding/page.tsx")),
    ).toBe(true);
    expect(existsSync(join(process.cwd(), "app/(app)/onboarding"))).toBe(false);
  });

  it("does not cover the four other email-link paths either", () => {
    // proxy.ts explains per path what breaks if one of these is gated: a
    // returning invitee arrives signed in, a verification link is opened in
    // the browser that just registered, and so on.
    for (const path of [
      "verify-email",
      "accept-invite",
      "forgot-password",
      "reset-password",
    ]) {
      expect(
        existsSync(join(process.cwd(), `app/(auth)/${path}/page.tsx`)),
        path,
      ).toBe(true);
      expect(existsSync(join(process.cwd(), `app/(app)/${path}`)), path).toBe(
        false,
      );
    }
  });
});
