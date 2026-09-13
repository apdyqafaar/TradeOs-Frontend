import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isApiError } from "@/lib/api/errors";

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
 * subtle bugs have actually lived, and a service test that skipped them would
 * be testing a function that calls a function. Copied from
 * `features/reports/services/report.service.test.ts`.
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

/** The requests the adapter saw, so a test can assert method, URL and params. */
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
  return await import("./digest.service");
}

const envelope = (data: unknown, status = 200) => ({
  status,
  data: { success: true, message: "ok", data },
});

beforeEach(() => {
  seen = [];
});

describe("runDigest", () => {
  it("posts to /digests/run and unwraps the 202 envelope to { localDate }", async () => {
    const service = await loadService(
      envelope({ localDate: "2026-09-13" }, 202),
    );

    const result = await service.runDigest();

    expect(seen[0]?.method).toBe("post");
    expect(seen[0]?.url).toBe("/digests/run");
    expect(result).toEqual({ localDate: "2026-09-13" });
  });
});

describe("failures", () => {
  it("turns a 429 with x-request-id into an ApiError with status 429 and that requestId", async () => {
    const service = await loadService({
      status: 429,
      data: {
        success: false,
        message: "Too many digest runs. Try again later.",
        code: "TOO_MANY_REQUESTS",
      },
      headers: { "x-request-id": "req-digest-429" },
    });

    await expect(service.runDigest()).rejects.toSatisfy((error: unknown) => {
      if (!isApiError(error)) return false;
      expect(error.status).toBe(429);
      expect(error.requestId).toBe("req-digest-429");
      return true;
    });
  });
});

describe("reads", () => {
  it("getLatestDigest hits /digests/latest and getDigest hits /digests/:id", async () => {
    const service = await loadService(envelope({ id: "d1" }));

    await service.getLatestDigest();
    expect(seen[0]?.url).toBe("/digests/latest");

    await service.getDigest("d1");
    expect(seen[1]?.url).toBe("/digests/d1");
  });
});
