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
 * dependencies (CLAUDE.md §Testing). The interceptors are where the subtle bugs
 * in this app have actually lived — a structural `isApiError` that also matched
 * `AxiosError`, a header lookup that missed `X-Request-Id` — so a service test
 * that skipped them would be testing a function that calls a function.
 *
 * Adapters, not axios itself, decide whether a status settles or rejects, which
 * is what this reproduces.
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

async function loadService(reply: Reply) {
  vi.resetModules();
  seen = [];
  const client = await import("@/lib/api/client");
  const adapter = replyWith(reply);
  client.api.defaults.adapter = async (config) => {
    seen.push(config);
    return adapter(config);
  };
  return await import("./announcement.service");
}

const wire = {
  id: "68b0000000000000000000a1",
  title: "Holiday hours",
  body: "We close early on Friday.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
};

beforeEach(() => {
  seen = [];
});

describe("announcement service", () => {
  it("lists with page and limit as query params, and unwraps data + meta", async () => {
    const service = await loadService({
      status: 200,
      data: {
        success: true,
        message: "Announcements fetched",
        data: [wire],
        meta: { page: 2, limit: 20, total: 41, totalPages: 3 },
      },
    });

    const result = await service.list({ page: 2, limit: 20 });

    expect(result.items).toEqual([wire]);
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
    // `{ params }`, not `params`: passing the filter object as the axios config
    // type-checks and sends no query string at all.
    expect(seen[0].params).toEqual({ page: 2, limit: 20 });
    expect(seen[0].url).toBe("/announcements");
  });

  it("sends no organization id — the tenant comes from the session cookie", async () => {
    const service = await loadService({
      status: 201,
      data: { success: true, message: "Created", data: wire },
    });

    await service.create({ title: "T", body: "B", pinned: false });

    expect(JSON.stringify(seen[0].data)).not.toContain("organizationId");
    expect(seen[0].withCredentials).toBe(true);
  });

  it("patches with only the fields it was given", async () => {
    const service = await loadService({
      status: 200,
      data: {
        success: true,
        message: "Updated",
        data: { ...wire, pinned: true },
      },
    });

    await service.update("68b0000000000000000000a1", { pinned: true });

    expect(seen[0].method).toBe("patch");
    expect(seen[0].url).toBe("/announcements/68b0000000000000000000a1");
    expect(JSON.parse(String(seen[0].data))).toEqual({ pinned: true });
  });

  it("keeps a pinned:false patch on the wire — false is a value, not an absence", async () => {
    const service = await loadService({
      status: 200,
      data: { success: true, message: "Updated", data: wire },
    });

    await service.update("68b0000000000000000000a1", { pinned: false });

    // If anything between here and the network dropped a falsy field, the Unpin
    // button would post `{}` and get a 422 keyed `"_"`.
    expect(JSON.parse(String(seen[0].data))).toEqual({ pinned: false });
  });

  it("keeps coverUploadId:null on the wire — the instruction to delete the image", async () => {
    const service = await loadService({
      status: 200,
      data: { success: true, message: "Updated", data: wire },
    });

    await service.update("68b0000000000000000000a1", { coverUploadId: null });

    // Present AND null. Dropping the key means "keep the cover".
    const body = JSON.parse(String(seen[0].data));
    expect("coverUploadId" in body).toBe(true);
    expect(body.coverUploadId).toBeNull();
  });

  it("resolves to nothing on a 204 delete, which carries no body at all", async () => {
    // Not `{ success: true }` — `noContentResponse` sends an empty 204
    // (`responses.ts:50`). A caller awaiting a row back would await `undefined`.
    const service = await loadService({ status: 204 });

    await expect(
      service.remove("68b0000000000000000000a1"),
    ).resolves.toBeUndefined();
    expect(seen[0].method).toBe("delete");
  });

  it("normalises a 404 into an ApiError carrying the request id", async () => {
    const service = await loadService({
      status: 404,
      data: {
        success: false,
        message: "Announcement not found",
        code: "NOT_FOUND",
      },
      headers: { "X-Request-Id": "req_abc" },
    });

    const error = await service
      .getById("68b0000000000000000000a1")
      .catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error("unreachable");
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    // The one thing that links what the user saw to the server's log line.
    expect(error.requestId).toBe("req_abc");
  });

  it('surfaces a 422\'s field errors, including the body-level "_" key', async () => {
    // The empty-PATCH refusal. An object-level zod issue has an empty path and
    // the API keys it `"_"`, which is not a field any form has a control for.
    const service = await loadService({
      status: 422,
      data: {
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: { _: "At least one field must be provided" },
      },
    });

    const error = await service
      .update("68b0000000000000000000a1", {})
      .catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error("unreachable");
    expect(error.fieldErrors).toEqual({
      _: "At least one field must be provided",
    });
  });
});
