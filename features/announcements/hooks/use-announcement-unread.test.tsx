import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "@/features/auth/keys";
import type { SessionData } from "@/features/auth/services/auth.service";
import { api } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { announcementKeys } from "../keys";
import type { Announcement } from "../types";
import {
  useMarkAllAnnouncementsRead,
  useMarkAnnouncementRead,
  useMarkAnnouncementReadOnView,
  useUnreadAnnouncementCount,
} from "./use-announcement-unread";

// The 429 branch of the response interceptor reaches for a toast; the real
// sonner needs a mounted <Toaster />, which has nothing to do with this file.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

interface Reply {
  status: number;
  data?: unknown;
}

/**
 * Mocked at the **axios adapter** (CLAUDE.md §Testing), not by stubbing this
 * slice's own service. The interceptors are where the subtle bugs in this app
 * have actually lived — a structural `isApiError` that also matched
 * `AxiosError`, a header lookup that missed `X-Request-Id` — so a hook test
 * that swapped the service out would be testing a function that calls a
 * function, and would not notice that `unreadCount` returns `{ count }` rather
 * than a number.
 *
 * Routed by URL rather than by call order, because a hook may fire more than
 * one request and the order is React Query's business, not the test's.
 */
const routes = new Map<string, Reply>();
/** Every request the adapter saw, so a test can count them. */
let seen: InternalAxiosRequestConfig[] = [];

const adapter: AxiosAdapter = async (config) => {
  seen.push(config);
  const key = `${String(config.method).toUpperCase()} ${config.url}`;
  const reply = routes.get(key) ?? {
    status: 404,
    data: { success: false, message: `no route for ${key}`, code: "NOT_FOUND" },
  };

  const response: AxiosResponse = {
    data: reply.data,
    status: reply.status,
    statusText: "",
    headers: new AxiosHeaders(),
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

const route = (key: string, data: unknown, status = 200) =>
  routes.set(key, { status, data: { success: true, message: "ok", data } });

const session = (permissions: string[]): SessionData => ({
  user: {
    id: "68b0000000000000000000f1",
    name: "Amina Mohamed",
    email: "amina@example.com",
    emailVerified: true,
  },
  organization: {
    id: "68b0000000000000000000e1",
    name: "Bakaara Traders",
    slug: "bakaara",
    timezone: "Africa/Nairobi",
  },
  role: { id: "68b0000000000000000000d1", name: "Seller" },
  permissions,
  twoFactorEnabled: false,
});

/**
 * `useCan` is left **real** and fed through the session cache, rather than
 * mocked. The permission gate on these hooks is the thing under test; stubbing
 * `useCan` would test that a mock returns what it was told to.
 */
function harness(permissions: string[] = ["announcements:view"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(authKeys.session(), session(permissions));

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

const row = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "68b0000000000000000000a1",
  title: "Stock take this Saturday",
  body: "We close the counter at 15:00.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina Mohamed" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

const page = (items: Announcement[]): Paginated<Announcement> => ({
  items,
  meta: { page: 1, limit: 20, total: items.length, totalPages: 1 },
});

beforeEach(() => {
  routes.clear();
  seen = [];
  api.defaults.adapter = adapter;
});

describe("useUnreadAnnouncementCount", () => {
  it("projects the envelope's { count } down to a number", async () => {
    route("GET /announcements/unread-count", { count: 3 });
    const { wrapper } = harness();

    const { result } = renderHook(() => useUnreadAnnouncementCount(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBe(3));
  });

  it("does not fetch for a caller without announcements:view", async () => {
    // The guard is `enabled`, not a `catch`. This hook is mounted in the
    // **sidebar**, so a 403 here would fire on every screen in the product
    // rather than on the one page that asked for it.
    route("GET /announcements/unread-count", { count: 3 });
    const { wrapper } = harness(["sales:view"]);

    const { result } = renderHook(() => useUnreadAnnouncementCount(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(seen).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch before the session has resolved", async () => {
    // `useCan` is false while the session loads, which is exactly when a nav
    // badge must not be making requests.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUnreadAnnouncementCount(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(
      seen.filter((c) => c.url === "/announcements/unread-count"),
    ).toHaveLength(0);
  });

  it("reports a failure as undefined rather than throwing at the sidebar", async () => {
    routes.set("GET /announcements/unread-count", {
      status: 500,
      data: { success: false, message: "boom", code: "INTERNAL_SERVER_ERROR" },
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useUnreadAnnouncementCount(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The badge renders nothing without a number, so an unreachable API costs
    // a missing dot rather than an error card bolted to every screen.
    expect(result.current.data).toBeUndefined();
  });
});

describe("useMarkAnnouncementRead", () => {
  it("patches the cached detail and every cached page with the server's readAt", async () => {
    route("POST /announcements/68b0000000000000000000a1/read", {
      id: "68b0000000000000000000a1",
      readAt: "2026-09-10T09:00:00.000Z",
    });
    route("GET /announcements/unread-count", { count: 2 });

    const { queryClient, wrapper } = harness();
    queryClient.setQueryData(
      announcementKeys.detail("68b0000000000000000000a1"),
      row({ readAt: null }),
    );
    queryClient.setQueryData(
      announcementKeys.list({ page: 1 }),
      page([row({ readAt: null }), row({ id: "other", readAt: null })]),
    );

    const { result } = renderHook(() => useMarkAnnouncementRead(), { wrapper });
    await act(async () => {
      result.current.mutate("68b0000000000000000000a1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      queryClient.getQueryData<Announcement>(
        announcementKeys.detail("68b0000000000000000000a1"),
      )?.readAt,
    ).toBe("2026-09-10T09:00:00.000Z");

    // Patched in place rather than invalidated: `readAt` takes no part in the
    // `{ pinned, createdAt }` sort, so unlike a pin this cannot move a row on
    // to another page and cannot disagree with the server about what page 2
    // holds. Invalidating would refetch the whole feed on every read.
    const cached = queryClient.getQueryData<Paginated<Announcement>>(
      announcementKeys.list({ page: 1 }),
    );
    expect(cached?.items[0].readAt).toBe("2026-09-10T09:00:00.000Z");
    expect(cached?.items[1].readAt).toBeNull();
  });

  it("invalidates the count rather than decrementing it", async () => {
    // Client-side arithmetic is wrong the moment the same member has the app
    // open on a second device, and it is wrong in the direction that matters:
    // a badge stuck at 1 that nothing can clear.
    route("POST /announcements/68b0000000000000000000a1/read", {
      id: "68b0000000000000000000a1",
      readAt: "2026-09-10T09:00:00.000Z",
    });
    route("GET /announcements/unread-count", { count: 1 });

    const { queryClient, wrapper } = harness();
    const invalidated: unknown[] = [];
    const real = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
      return real(filters as never);
    }) as typeof queryClient.invalidateQueries;

    const { result } = renderHook(() => useMarkAnnouncementRead(), { wrapper });
    await act(async () => {
      result.current.mutate("68b0000000000000000000a1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidated).toContainEqual(announcementKeys.unreadCount());
    // NOT the lists: a read does not move a row.
    expect(invalidated).not.toContainEqual(announcementKeys.lists());
  });
});

describe("useMarkAllAnnouncementsRead", () => {
  it("invalidates the feed and the count instead of inventing timestamps", async () => {
    // The response is `{ count }` and carries no per-row `readAt`, so patching
    // the cache would mean stamping every visible row with a value this client
    // made up.
    route("POST /announcements/read-all", { count: 4 });
    route("GET /announcements/unread-count", { count: 0 });

    const { queryClient, wrapper } = harness();
    const invalidated: unknown[] = [];
    const real = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
      return real(filters as never);
    }) as typeof queryClient.invalidateQueries;

    const { result } = renderHook(() => useMarkAllAnnouncementsRead(), {
      wrapper,
    });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ count: 4 });
    expect(invalidated).toContainEqual(announcementKeys.lists());
    expect(invalidated).toContainEqual(announcementKeys.unreadCount());
  });
});

describe("useMarkAnnouncementReadOnView", () => {
  const readUrl = "POST /announcements/68b0000000000000000000a1/read";
  const reads = () =>
    seen.filter(
      (c) => c.url === "/announcements/68b0000000000000000000a1/read",
    );

  beforeEach(() => {
    route(readUrl, {
      id: "68b0000000000000000000a1",
      readAt: "2026-09-10T09:00:00.000Z",
    });
    route("GET /announcements/unread-count", { count: 0 });
  });

  it("marks the notice read once the row has arrived", async () => {
    const { wrapper } = harness();
    renderHook(() => useMarkAnnouncementReadOnView(row({ readAt: null })), {
      wrapper,
    });

    await waitFor(() => expect(reads()).toHaveLength(1));
  });

  it("fires once, not once per render", async () => {
    // The mutation's own success handler writes `readAt` into the cached
    // detail, which re-renders whatever is showing it. Without the ref guard
    // the first success re-triggers the effect.
    const { wrapper } = harness();
    const { rerender } = renderHook(
      ({ announcement }: { announcement: Announcement }) =>
        useMarkAnnouncementReadOnView(announcement),
      { wrapper, initialProps: { announcement: row({ readAt: null }) } },
    );

    await waitFor(() => expect(reads()).toHaveLength(1));

    // A refetch hands back a new object with the same id — the commonest way
    // this fires twice.
    rerender({ announcement: row({ readAt: null }) });
    rerender({ announcement: row({ readAt: null }) });
    await act(async () => {});

    expect(reads()).toHaveLength(1);
  });

  it("does nothing while the announcement is still loading", async () => {
    // Firing on the id alone would post a receipt for a notice that turns out
    // to be a 404 or a 403 — a write on behalf of somebody who saw nothing.
    const { wrapper } = harness();
    renderHook(() => useMarkAnnouncementReadOnView(undefined), { wrapper });

    await act(async () => {});
    expect(reads()).toHaveLength(0);
  });

  it("does nothing for a caller without announcements:view", async () => {
    // The endpoint is gated on the same permission the read is. A caller who
    // cannot read the notice must not be posting a receipt for it.
    const { wrapper } = harness(["sales:view"]);
    renderHook(() => useMarkAnnouncementReadOnView(row({ readAt: null })), {
      wrapper,
    });

    await act(async () => {});
    expect(reads()).toHaveLength(0);
  });

  it("does nothing when the row already carries a readAt", async () => {
    // The endpoint is idempotent, so this is a saved request rather than a
    // correctness fix — but it is the difference between one POST the first
    // time a notice is opened and one every time anybody re-reads it.
    const { wrapper } = harness();
    renderHook(
      () =>
        useMarkAnnouncementReadOnView(
          row({ readAt: "2026-09-09T06:00:00.000Z" }),
        ),
      { wrapper },
    );

    await act(async () => {});
    expect(reads()).toHaveLength(0);
  });

  it("marks the next notice when one mounted screen moves between them", async () => {
    // The guard holds an id, not a boolean, so navigating from one notice to
    // another inside the same mounted route still marks the second.
    route("POST /announcements/68b0000000000000000000a2/read", {
      id: "68b0000000000000000000a2",
      readAt: "2026-09-10T09:05:00.000Z",
    });

    const { wrapper } = harness();
    const { rerender } = renderHook(
      ({ announcement }: { announcement: Announcement }) =>
        useMarkAnnouncementReadOnView(announcement),
      { wrapper, initialProps: { announcement: row({ readAt: null }) } },
    );

    await waitFor(() => expect(reads()).toHaveLength(1));

    rerender({
      announcement: row({ id: "68b0000000000000000000a2", readAt: null }),
    });

    await waitFor(() =>
      expect(
        seen.filter(
          (c) => c.url === "/announcements/68b0000000000000000000a2/read",
        ),
      ).toHaveLength(1),
    );
  });

  it("still marks read when the API sends no readAt on the row at all", async () => {
    // `readAt` is optional because read tracking arrived as aggregates. An
    // absent field means "unknown", and the only safe answer to unknown is to
    // post the receipt — the endpoint is idempotent.
    const { wrapper } = harness();
    renderHook(() => useMarkAnnouncementReadOnView(row()), { wrapper });

    await waitFor(() => expect(reads()).toHaveLength(1));
  });
});
