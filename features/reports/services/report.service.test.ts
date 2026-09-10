import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isApiError } from "@/lib/api/errors";
import { isPeriodError } from "@/lib/period";

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
 * be testing a function that calls a function.
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
  return await import("./report.service");
}

const envelope = (data: unknown) => ({
  status: 200,
  data: { success: true, message: "Fetched", data },
});

beforeEach(() => {
  seen = [];
});

describe("report URLs", () => {
  it("asks /reports/dashboard, never /dashboard", async () => {
    // The trap this whole slice is built around: `GET /reports/dashboard` and
    // `GET /dashboard` are different endpoints on different permissions with
    // different shapes — and the identical success message, so crossing them
    // fails silently (`docs/contracts/reports.md` §5).
    const service = await loadService(envelope({ revenue: 199 }));
    await service.getReportsDashboard({ period: "month" });

    expect(seen[0]?.url).toBe("/reports/dashboard");
    expect(seen[0]?.params).toEqual({ period: "month" });
  });

  it("sends a preset as one key and a range as two, never both", async () => {
    // `period` and `from`/`to` are mutually exclusive and `from`/`to` must be
    // given together — both refinements are 422s, not ignored keys (§1.1).
    const service = await loadService(envelope({ items: [] }));

    await service.getSalesSummary({ period: "year" });
    expect(seen[0]?.params).toEqual({ period: "year" });

    await service.getSalesSummary({ from: "2026-09-01", to: "2026-09-30" });
    expect(seen[1]?.params).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(seen[1]?.params).not.toHaveProperty("period");
  });

  it("sends no query at all for the two point-in-time reports", async () => {
    // `stockQuerySchema` and `debtsAgeingQuerySchema` are literally
    // `z.object({}).strict()`, so **any** query key is a 422 — including a
    // helpfully-forwarded `period` (§1.2).
    const service = await loadService(envelope({ trackedCount: 0 }));

    await service.getStockReport();
    await service.getDebtsAgeing();

    expect(seen[0]?.url).toBe("/reports/products/stock");
    expect(seen[0]?.params).toBeUndefined();
    expect(seen[1]?.url).toBe("/reports/debts/ageing");
    expect(seen[1]?.params).toBeUndefined();
  });

  it("sends dead stock's days without a period", async () => {
    // `deadProductsQuerySchema` is `.strict()` with only `days`, so a period
    // tagging along is a 422 (§1.2).
    const service = await loadService(envelope({ items: [] }));
    await service.getDeadStock(90);

    expect(seen[0]?.url).toBe("/reports/products/dead");
    expect(seen[0]?.params).toEqual({ days: 90 });
  });

  it("carries by, limit and granularity alongside the period", async () => {
    const service = await loadService(envelope({ items: [] }));

    await service.getTopProducts(
      { from: "2026-09-01", to: "2026-09-07" },
      "quantity",
      50,
    );
    await service.getSalesTrend({ period: "week" }, "month");
    await service.getTopCustomers({ period: "today" }, "balance", 25);

    expect(seen[0]?.params).toEqual({
      from: "2026-09-01",
      to: "2026-09-07",
      by: "quantity",
      limit: 50,
    });
    expect(seen[1]?.params).toEqual({ period: "week", granularity: "month" });
    expect(seen[2]?.params).toEqual({
      period: "today",
      by: "balance",
      limit: 25,
    });
  });
});

describe("period failures", () => {
  it("surfaces PERIOD_TOO_LONG as a 400 the UI can branch on", async () => {
    // The three period codes are **400s raised after validation passed**, not
    // the 422 a bad query param normally produces — which is how they went
    // unmapped in `API_ERROR_CODE` until this slice (§1.4).
    const service = await loadService({
      status: 400,
      data: {
        success: false,
        message: "Range cannot exceed 366 days",
        code: "PERIOD_TOO_LONG",
      },
      headers: { "x-request-id": "req-42" },
    });

    await expect(
      service.getSalesSummary({ from: "2025-01-01", to: "2026-06-01" }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!isApiError(error)) return false;
      expect(error.status).toBe(400);
      expect(error.code).toBe("PERIOD_TOO_LONG");
      expect(error.requestId).toBe("req-42");
      // The predicate every report screen uses to put the message on the
      // period bar rather than over the whole page.
      expect(isPeriodError(error)).toBe(true);
      return true;
    });
  });
});
