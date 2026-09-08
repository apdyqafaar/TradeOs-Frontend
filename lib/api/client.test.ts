import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

// The 429 branch reaches for a toast; the real sonner needs a mounted
// <Toaster />, which has nothing to do with what these tests check.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

interface Reply {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * A stand-in for the network. Adapters — not axios itself — decide whether a
 * status settles or rejects, so this reproduces that: a 2xx resolves, anything
 * else throws the AxiosError the real adapter would have thrown.
 */
const replyWith = (reply: Reply): AxiosAdapter => {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = {
      data: reply.data,
      status: reply.status,
      statusText: "",
      headers: new AxiosHeaders(reply.headers ?? {}),
      config,
    };
    if (reply.status >= 200 && reply.status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${reply.status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  };
};

/** No response at all — DNS failure, offline, CORS refusal. */
const networkFailure: AxiosAdapter = async (
  config: InternalAxiosRequestConfig,
) => {
  throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config, {});
};

const locationAssign = vi.fn();

/**
 * A fresh copy of the module for every test.
 *
 * The one-redirect-per-page guard is a module-level flag by design, so it has
 * to be reset between cases; resetting the module graph is the honest way to
 * do that without exporting a test-only escape hatch from production code.
 */
async function loadClient(adapter: AxiosAdapter) {
  vi.resetModules();
  const client = await import("@/lib/api/client");
  client.api.defaults.adapter = adapter;
  const { toast } = await import("sonner");
  return { ...client, toast };
}

/** Wherever happy-dom put us; the `next` parameter should echo exactly this. */
const currentPath = () =>
  `${window.location.pathname}${window.location.search}`;

beforeEach(() => {
  locationAssign.mockClear();
  vi.spyOn(window.location, "assign").mockImplementation(locationAssign);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("response unwrapping", () => {
  it("hands back envelope.data, not the envelope", async () => {
    const { apiGet } = await loadClient(
      replyWith({
        status: 200,
        data: {
          success: true,
          message: "Current session",
          data: { user: { id: "u1", name: "Amina" }, permissions: ["*"] },
        },
      }),
    );

    await expect(apiGet("/auth/me")).resolves.toEqual({
      user: { id: "u1", name: "Amina" },
      permissions: ["*"],
    });
  });

  it("resolves to undefined for a 204", async () => {
    const { apiDelete } = await loadClient(
      replyWith({ status: 204, data: "" }),
    );
    await expect(apiDelete("/auth/passkeys/abc")).resolves.toBeUndefined();
  });

  it("turns a body that is not an envelope into UNEXPECTED_RESPONSE", async () => {
    // A proxy returning its own HTML error page on a 200 is the real case.
    const { apiGet } = await loadClient(
      replyWith({ status: 200, data: "<!doctype html><title>Gateway</title>" }),
    );

    await expect(apiGet("/products")).rejects.toMatchObject({
      status: 500,
      code: API_ERROR_CODE.UNEXPECTED_RESPONSE,
    });
  });
});

describe("apiGetList", () => {
  it("preserves the envelope's meta alongside the rows", async () => {
    const { apiGetList } = await loadClient(
      replyWith({
        status: 200,
        data: {
          success: true,
          message: "Products fetched",
          data: [{ id: "p1" }, { id: "p2" }],
          meta: { page: 2, limit: 20, total: 57, totalPages: 3 },
        },
      }),
    );

    await expect(apiGetList("/products")).resolves.toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      meta: { page: 2, limit: 20, total: 57, totalPages: 3 },
    });
  });

  it("does not leak meta onto the rows themselves", async () => {
    const { apiGetList } = await loadClient(
      replyWith({
        status: 200,
        data: {
          success: true,
          message: "Products fetched",
          data: [{ id: "p1" }],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }),
    );

    const { items } = await apiGetList<{ id: string }>("/products");
    expect(Object.keys(items)).toEqual(["0"]);
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ id: "p1" }]);
  });

  it("describes what arrived when an endpoint sends no meta", async () => {
    const { apiGetList } = await loadClient(
      replyWith({
        status: 200,
        data: {
          success: true,
          message: "Roles fetched",
          data: [{ id: "r1" }, { id: "r2" }],
        },
      }),
    );

    await expect(apiGetList("/roles")).resolves.toEqual({
      items: [{ id: "r1" }, { id: "r2" }],
      meta: { page: 1, limit: 2, total: 2, totalPages: 1 },
    });
  });
});

describe("error normalization", () => {
  it("maps a 422 onto fieldErrors and keeps the code and message", async () => {
    const { apiPost } = await loadClient(
      replyWith({
        status: 422,
        data: {
          success: false,
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          errors: {
            email: "Enter a valid email address",
            password: "Password is required",
          },
        },
      }),
    );

    await expect(apiPost("/auth/register", {})).rejects.toMatchObject({
      status: 422,
      code: API_ERROR_CODE.VALIDATION_ERROR,
      message: "Validation failed",
      fieldErrors: {
        email: "Enter a valid email address",
        password: "Password is required",
      },
    });
  });

  it("captures x-request-id off the response headers", async () => {
    const { apiGet } = await loadClient(
      replyWith({
        status: 409,
        data: {
          success: false,
          message: "Not enough stock",
          code: "INSUFFICIENT_STOCK",
          details: { available: 2 },
        },
        headers: { "X-Request-Id": "req_7f3a91" },
      }),
    );

    await expect(apiGet("/products")).rejects.toMatchObject({
      status: 409,
      code: API_ERROR_CODE.INSUFFICIENT_STOCK,
      requestId: "req_7f3a91",
      details: { available: 2 },
    });
  });

  it("turns a dead network into an ApiError with status 0 and NETWORK_ERROR", async () => {
    const { apiGet } = await loadClient(networkFailure);

    const error = await apiGet("/products").catch((thrown: unknown) => thrown);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 0,
      code: API_ERROR_CODE.NETWORK_ERROR,
    });
  });

  it("defaults the code from the status when the body carried none", async () => {
    const { apiGet } = await loadClient(
      replyWith({ status: 404, data: "Not Found" }),
    );

    await expect(apiGet("/products/nope")).rejects.toMatchObject({
      status: 404,
      code: API_ERROR_CODE.NOT_FOUND,
    });
  });
});

describe("401 handling", () => {
  const unauthorized = replyWith({
    status: 401,
    data: {
      success: false,
      message: "Email or password is incorrect",
      code: "UNAUTHORIZED",
    },
  });

  it("does not redirect when the 401 came from /auth/login", async () => {
    // The login form shows this inline. Navigating would wipe what was typed.
    const { apiPost } = await loadClient(unauthorized);

    await expect(apiPost("/auth/login", {})).rejects.toMatchObject({
      status: 401,
    });
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it.each([
    "/auth/register",
    "/auth/accept-invite",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/verify-email",
    "/auth/2fa/challenge",
    "/auth/passkeys/login/verify",
  ])("does not redirect when the 401 came from %s", async (path) => {
    const { apiPost } = await loadClient(unauthorized);

    await expect(apiPost(path, {})).rejects.toMatchObject({ status: 401 });
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it("redirects to /login with the current path when the 401 came from /products", async () => {
    const { apiGet } = await loadClient(unauthorized);
    const from = currentPath();

    await expect(apiGet("/products")).rejects.toMatchObject({ status: 401 });

    expect(locationAssign).toHaveBeenCalledTimes(1);
    const target = String(locationAssign.mock.calls[0]?.[0]);
    expect(target.startsWith("/login?next=")).toBe(true);
    expect(decodeURIComponent(target.slice("/login?next=".length))).toBe(from);
  });

  it("redirects once however many requests fail together", async () => {
    // A dashboard fires six queries; an expired cookie fails all six at once.
    const { apiGet } = await loadClient(unauthorized);

    await Promise.allSettled([
      apiGet("/products"),
      apiGet("/customers"),
      apiGet("/sales"),
      apiGet("/debts"),
    ]);

    expect(locationAssign).toHaveBeenCalledTimes(1);
  });
});

describe("429 handling", () => {
  it("toasts the rate-limit message", async () => {
    const { apiPost, toast } = await loadClient(
      replyWith({
        status: 429,
        data: {
          success: false,
          message: "Too many requests, please try again later",
          code: "TOO_MANY_REQUESTS",
        },
      }),
    );

    await expect(apiPost("/auth/login", {})).rejects.toMatchObject({
      status: 429,
      code: API_ERROR_CODE.TOO_MANY_REQUESTS,
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Too many requests, please try again later",
    );
  });
});
