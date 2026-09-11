import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, hasCode, isApiError } from "@/lib/api/errors";

// The 429 branch of the response interceptor reaches for a toast; the real
// sonner needs a mounted <Toaster />, which has nothing to do with this file.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

interface Reply {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * Mocked at the **axios adapter**, not by stubbing the service's own
 * dependencies (CLAUDE.md §Testing): the interceptors are where this app's
 * subtle bugs have actually lived, and they are what turns the envelope into
 * domain data and a 409 into an `ApiError` carrying `details`.
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

/** The requests the adapter saw, so a test can assert method and URL. */
let seen: InternalAxiosRequestConfig[] = [];

async function loadService(reply: Reply = { status: 200, data: {} }) {
  vi.resetModules();
  seen = [];
  const client = await import("@/lib/api/client");
  const adapter = replyWith(reply);
  client.api.defaults.adapter = async (config) => {
    seen.push(config);
    return adapter(config);
  };
  return await import("./product.service");
}

const envelope = (data: unknown) => ({
  status: 200,
  data: { success: true, message: "Done", data },
});

beforeEach(() => {
  seen = [];
});

describe("the two DELETEs are different endpoints", () => {
  it("archive goes to /products/:id", async () => {
    const service = await loadService(envelope({ id: "p1" }));
    await service.archive("p1");

    expect(seen[0]?.method?.toUpperCase()).toBe("DELETE");
    expect(seen[0]?.url).toBe("/products/p1");
  });

  it("delete goes to /products/:id/permanent", async () => {
    // The whole safety of this pair rests on the URL. Sending a permanent
    // delete to the archive path silently archives instead — a no-op the user
    // reads as success — and sending an archive to the permanent path destroys
    // a product they meant to keep. Neither failure is visible in a component
    // test, which never sees a URL.
    const service = await loadService(envelope({ id: "p1" }));
    await service.remove("p1");

    expect(seen[0]?.method?.toUpperCase()).toBe("DELETE");
    expect(seen[0]?.url).toBe("/products/p1/permanent");
  });

  it("never sends an organization id", async () => {
    // The API resolves the tenant from the session. Sending one would be dead
    // weight at best and a cross-tenant attempt at worst.
    const service = await loadService(envelope({ id: "p1" }));
    await service.remove("p1");

    expect(JSON.stringify(seen[0]?.params ?? {})).not.toMatch(/organization/i);
    expect(seen[0]?.data).toBeUndefined();
  });
});

describe("the permanent delete's refusal", () => {
  it("arrives as an ApiError carrying the code and the sale count", async () => {
    // `details.saleCount` is what the dialog puts in front of the user, and it
    // only survives if the response interceptor copies `details` off the
    // envelope. That is the link this test exists to hold.
    const service = await loadService({
      status: 409,
      data: {
        success: false,
        message: "This product has been sold 4 times and cannot be deleted.",
        code: "PRODUCT_HAS_SALES",
        details: { saleCount: 4 },
      },
      headers: { "X-Request-Id": "req-41" },
    });

    const failure = await service.remove("p1").catch((error: unknown) => error);

    expect(isApiError(failure)).toBe(true);
    if (!isApiError(failure)) return;

    expect(failure.status).toBe(409);
    expect(hasCode(failure, API_ERROR_CODE.PRODUCT_HAS_SALES)).toBe(true);
    expect(failure.details).toEqual({ saleCount: 4 });
    expect(failure.requestId).toBe("req-41");
  });

  it("unwraps a successful delete to the id, not the envelope", async () => {
    const service = await loadService(envelope({ id: "p1" }));
    await expect(service.remove("p1")).resolves.toEqual({ id: "p1" });
  });
});
