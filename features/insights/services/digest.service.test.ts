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

const envelope = (data: unknown, status = 200, meta?: unknown) => ({
  status,
  data: { success: true, message: "ok", data, ...(meta ? { meta } : {}) },
});

beforeEach(() => {
  seen = [];
});

const runAnswer = {
  localDate: "2026-09-13",
  period: {
    preset: "last7" as const,
    from: "2026-09-06T21:00:00.000Z",
    to: "2026-09-13T21:00:00.000Z",
  },
  quota: {
    limit: 2,
    used: 1,
    remaining: 1,
    resetsAt: "2026-09-14T21:00:00.000Z",
  },
};

describe("runDigest", () => {
  it("posts to /digests/run and unwraps the 202 envelope, quota and all", async () => {
    const service = await loadService(envelope(runAnswer, 202));

    const result = await service.runDigest();

    expect(seen[0]?.method).toBe("post");
    expect(seen[0]?.url).toBe("/digests/run");
    // The allowance rides back on the answer, so nothing has to refetch
    // `GET /digests/quota` to keep the header honest.
    expect(result.quota).toEqual(runAnswer.quota);
    expect(result.period.preset).toBe("last7");
  });

  it("sends no body at all by default, which the API still reads as today", async () => {
    // `runDigestBodySchema` is `.optional().transform(body => body ?? {})`
    // precisely so a bodyless "Generate now" keeps working; `{}` is the same
    // thing one step earlier.
    const service = await loadService(envelope(runAnswer, 202));

    await service.runDigest();

    expect(seen[0]?.data).toBe(JSON.stringify({}));
  });

  it("names the preset `period` on the wire, which is NOT what it is called on the way back", async () => {
    // `runDigestBodySchema` is `period: z.enum(DIGEST_PERIOD_PRESETS)` and is
    // `.strict()`, so sending `{ preset: "last7" }` is a 422 rather than a
    // silently-dropped field — and the 202 answers with a `period` that is an
    // OBJECT. One name, two shapes, opposite directions. `tsc` cannot see any
    // of this; only an assertion on the bytes can.
    const service = await loadService(envelope(runAnswer, 202));

    await service.runDigest({ preset: "last7" });

    expect(JSON.parse(String(seen[0]?.data))).toEqual({ period: "last7" });
  });

  it("sends a custom range as from/to beside it", async () => {
    const service = await loadService(envelope(runAnswer, 202));

    await service.runDigest({
      preset: "custom",
      from: "2026-09-01",
      to: "2026-09-07",
    });

    expect(JSON.parse(String(seen[0]?.data))).toEqual({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-07",
    });
  });
});

describe("list", () => {
  it("sends filters as query params, not as a config object", async () => {
    // The trap: `apiGetList(BASE, params)` hands axios a config it does not
    // recognise and sends no query string at all — a list stuck on page 1.
    // This is the bug `listDigests` was written wrong with once already, and
    // `{ page, limit }` is structurally assignable to `AxiosRequestConfig`
    // through a typed variable, so `tsc` will NOT catch a regression back to
    // it — only this assertion on the adapter's captured `params` will.
    // Same shape as `features/projects/services/project.service.test.ts`'s
    // "list" > "sends filters as query params, not as a config object".
    const service = await loadService(
      envelope([{ id: "d1" }], 200, {
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
      }),
    );

    const page = await service.listDigests({ page: 2, limit: 20 });

    expect(seen[0]?.url).toBe("/digests");
    expect(seen[0]?.params).toEqual({ page: 2, limit: 20 });
    expect(page.items).toEqual([{ id: "d1" }]);
    expect(page.meta).toEqual({
      page: 2,
      limit: 20,
      total: 21,
      totalPages: 2,
    });
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

describe("the manual-run quota", () => {
  it("reads GET /digests/quota and unwraps the envelope", async () => {
    const service = await loadService(
      envelope({
        limit: 3,
        used: 1,
        remaining: 2,
        resetsAt: "2026-09-16T00:00:00.000Z",
      }),
    );

    const quota = await service.getDigestQuota();

    expect(seen[0]?.url).toBe("/digests/quota");
    expect(seen[0]?.method).toBe("get");
    expect(quota).toEqual({
      limit: 3,
      used: 1,
      remaining: 2,
      resetsAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("rejects with an ApiError carrying status 404 while the route does not exist", async () => {
    // The live answer today: `Backend/src/routes/v1/digest.route.ts` has four
    // `/digests` rows and no quota among them, so a frontend deployed ahead of
    // the API gets this. `useDigestQuota` is what turns it into silence; the
    // point here is that it arrives as a normalized `ApiError` and not as a
    // raw `AxiosError` that would escape the hook's typing.
    const service = await loadService({
      status: 404,
      data: { success: false, message: "Not found", code: "NOT_FOUND" },
    });

    await expect(service.getDigestQuota()).rejects.toSatisfy(
      (error: unknown) => {
        if (!isApiError(error)) return false;
        expect(error.status).toBe(404);
        return true;
      },
    );
  });
});
