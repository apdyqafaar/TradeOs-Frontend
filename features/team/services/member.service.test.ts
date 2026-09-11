import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, hasCode, isApiError } from "@/lib/api/errors";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

interface Reply {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

/** Mocked at the axios adapter, so the interceptors are exercised too. */
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
  return await import("./member.service");
}

const row = {
  id: "m1",
  status: "active",
  joinedAt: "2026-08-01T09:00:00.000Z",
  createdAt: "2026-07-28T09:00:00.000Z",
  user: { id: "u1", name: "Hodan Yusuf", email: "hodan@wardher.test" },
  role: { id: "r-seller", name: "Seller" },
};

const envelope = (data: unknown) => ({
  status: 200,
  data: { success: true, message: "Member fetched", data },
});

beforeEach(() => {
  seen = [];
});

describe("member detail", () => {
  it("asks GET /members/:id", async () => {
    const service = await loadService(envelope(row));
    await service.get("m1");

    expect(seen[0]?.method?.toUpperCase()).toBe("GET");
    expect(seen[0]?.url).toBe("/members/m1");
  });

  it("unwraps to the row itself, not the envelope", async () => {
    // `apiGet`, not `apiGetList`: this endpoint answers ONE member and has no
    // `meta`. Reaching for `.data.data` here — the shape the list needs —
    // would produce `undefined` and a screen with no error.
    const service = await loadService(envelope(row));
    await expect(service.get("m1")).resolves.toEqual(row);
  });

  it("carries a 404 through as an ApiError the screen can branch on", async () => {
    // A removed member and an unknown id are the same 404, and the detail
    // screen renders "not on your team" for it rather than an error card. That
    // branch is `hasCode(error, NOT_FOUND)`, so the code has to survive the
    // interceptor.
    const service = await loadService({
      status: 404,
      data: { success: false, message: "Member not found", code: "NOT_FOUND" },
      headers: { "X-Request-Id": "req-9" },
    });

    const failure = await service.get("gone").catch((error: unknown) => error);

    expect(isApiError(failure)).toBe(true);
    if (!isApiError(failure)) return;
    expect(hasCode(failure, API_ERROR_CODE.NOT_FOUND)).toBe(true);
    expect(failure.requestId).toBe("req-9");
  });

  it("never sends an organization id", async () => {
    const service = await loadService(envelope(row));
    await service.get("m1");

    expect(JSON.stringify(seen[0]?.params ?? {})).not.toMatch(/organization/i);
  });
});
