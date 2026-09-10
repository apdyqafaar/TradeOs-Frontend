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
  return await import("./project.service");
}

const wire = {
  id: "68b0000000000000000000a1",
  title: "Shopfront refit",
  description: null,
  customerId: null,
  status: "planned",
  progress: 0,
  startDate: null,
  dueDate: null,
  isPublished: false,
  publishedAt: null,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
};

const ok = (data: unknown, meta?: unknown) => ({
  status: 200,
  data: { success: true, message: "ok", data, ...(meta ? { meta } : {}) },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list", () => {
  it("sends filters as query params, not as a config object", () => {
    // The trap: `apiGetList(BASE, params)` hands axios a config it does not
    // recognise and sends no query string at all — a list stuck on page 1.
    return loadService(
      ok([wire], { page: 2, limit: 20, total: 21, totalPages: 2 }),
    ).then(async (service) => {
      const page = await service.list({ page: 2, status: "in_progress" });
      expect(seen[0]?.url).toBe("/projects");
      expect(seen[0]?.params).toEqual({ page: 2, status: "in_progress" });
      expect(page.items).toHaveLength(1);
      expect(page.meta.totalPages).toBe(2);
    });
  });
});

describe("getById", () => {
  it("returns the unwrapped project and carries no share token", async () => {
    const service = await loadService(ok(wire));
    const project = await service.getById(wire.id);
    // Proven on the wire by `projects.test.ts:98-111`: no read endpoint ever
    // answers a token or a hash.
    expect(project).not.toHaveProperty("shareToken");
    expect(project).not.toHaveProperty("shareTokenHash");
    expect(project.isPublished).toBe(false);
  });
});

describe("publish", () => {
  it("sends no body at all", async () => {
    // `noBodySchema` is `.strict()`, so `{ projectId }` would be a 422. An
    // HTTP wrapper that helpfully attached a payload here would break publish
    // for everyone.
    const service = await loadService(
      ok({
        shareToken: "a".repeat(64),
        isPublished: true,
        publishedAt: "2026-09-10T09:00:00.000Z",
      }),
    );
    const result = await service.publish(wire.id);

    expect(seen[0]?.method).toBe("post");
    expect(seen[0]?.url).toBe(`/projects/${wire.id}/publish`);
    expect(seen[0]?.data).toBeUndefined();
    expect(result.shareToken).toBe("a".repeat(64));
  });

  it("surfaces ALREADY_PUBLISHED as an ApiError carrying the code", async () => {
    const service = await loadService({
      status: 409,
      data: {
        success: false,
        message: "Project is already published",
        code: "ALREADY_PUBLISHED",
      },
    });

    await expect(service.publish(wire.id)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isApiError(error)) return false;
        // Branching on `code`, never on `message` — and this is the proof the
        // code survives `errorResponse` onto the wire.
        return error.status === 409 && error.code === "ALREADY_PUBLISHED";
      },
    );
  });

  it("passes shareToken: null through rather than treating it as a failure", async () => {
    // The re-publish case: the hash was reused, so the plain token was never
    // regenerated and cannot be re-issued (contract §3.2).
    const service = await loadService(
      ok({
        shareToken: null,
        isPublished: true,
        publishedAt: "2026-09-10T09:00:00.000Z",
      }),
    );
    await expect(service.publish(wire.id)).resolves.toEqual({
      shareToken: null,
      isPublished: true,
      publishedAt: "2026-09-10T09:00:00.000Z",
    });
  });
});

describe("unpublish", () => {
  it("answers only { isPublished: false }", async () => {
    const service = await loadService(ok({ isPublished: false }));
    const result = await service.unpublish(wire.id);
    // No `publishedAt`, no `shareToken` — do not destructure the publish
    // response type from this one (contract trap 6).
    expect(Object.keys(result)).toEqual(["isPublished"]);
  });
});

describe("update notes", () => {
  it("posts to the project's own updates path", async () => {
    const service = await loadService({
      status: 201,
      data: {
        success: true,
        message: "created",
        data: {
          id: "68b0000000000000000000e1",
          projectId: wire.id,
          body: "Framing done",
          progress: 40,
          createdBy: "68b0000000000000000000b1",
          createdAt: "2026-09-10T09:00:00.000Z",
        },
      },
    });

    await service.createUpdate(wire.id, { body: "Framing done", progress: 40 });
    expect(seen[0]?.url).toBe(`/projects/${wire.id}/updates`);
    expect(seen[0]?.data).toBe(
      JSON.stringify({ body: "Framing done", progress: 40 }),
    );
  });

  it("scopes a delete by project as well as by update id", async () => {
    const service = await loadService({ status: 204 });
    await service.removeUpdate(wire.id, "68b0000000000000000000e1");
    expect(seen[0]?.method).toBe("delete");
    expect(seen[0]?.url).toBe(
      `/projects/${wire.id}/updates/68b0000000000000000000e1`,
    );
  });
});

describe("remove", () => {
  it("resolves with nothing on a 204", async () => {
    // 204 with no body at all, not `{ success: true }` (contract §0).
    const service = await loadService({ status: 204 });
    await expect(service.remove(wire.id)).resolves.toBeUndefined();
  });
});
