import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadKeys } from "@/features/uploads/keys";
import { announcementKeys } from "../keys";
import type { Announcement } from "../types";
import {
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
} from "./use-announcement-mutations";

const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
vi.mock("../services/announcement.service", () => ({
  create: (...args: unknown[]) => create(...args),
  update: (...args: unknown[]) => update(...args),
  remove: (...args: unknown[]) => remove(...args),
}));

const row = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "68b0000000000000000000a1",
  title: "Holiday hours",
  body: "We close early on Friday.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

/** The keys each mutation asked to be refetched, in the order it asked. */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const removed: unknown[] = [];

  const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return realInvalidate(filters as never);
  }) as typeof queryClient.invalidateQueries;

  const realRemove = queryClient.removeQueries.bind(queryClient);
  queryClient.removeQueries = ((filters?: { queryKey?: unknown }) => {
    removed.push(filters?.queryKey);
    return realRemove(filters as never);
  }) as typeof queryClient.removeQueries;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper, invalidated, removed };
}

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  remove.mockReset();
});

describe("useCreateAnnouncement", () => {
  it("seeds the detail entry from the response and invalidates every list page", async () => {
    // The create response is the same shape `GET /announcements/:id` answers,
    // from the same mapper, so seeding invents nothing.
    const created = row();
    create.mockResolvedValue(created);
    const { queryClient, wrapper, invalidated } = harness();

    const { result } = renderHook(() => useCreateAnnouncement(), { wrapper });
    await act(async () => {
      result.current.mutate({ title: "T", body: "B", pinned: false });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      queryClient.getQueryData(announcementKeys.detail(created.id)),
    ).toEqual(created);
    expect(invalidated).toContainEqual(announcementKeys.lists());
  });

  it("invalidates the upload gallery, because a cover just left the unattached set", async () => {
    create.mockResolvedValue(row());
    const { wrapper, invalidated } = harness();

    const { result } = renderHook(() => useCreateAnnouncement(), { wrapper });
    await act(async () => {
      result.current.mutate({ title: "T", body: "B", pinned: false });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidated).toContainEqual(uploadKeys.lists());
  });
});

describe("useUpdateAnnouncement", () => {
  it("invalidates the lists on a pin, because the sort runs before pagination", async () => {
    // Pinning moves a row to the head of page 1 and pushes the oldest row there
    // onto page 2. A `setQueryData` that flipped `pinned` in place would leave
    // the card where it was and disagree with the server about page 2.
    const pinned = row({ pinned: true });
    update.mockResolvedValue(pinned);
    const { queryClient, wrapper, invalidated } = harness();

    const { result } = renderHook(() => useUpdateAnnouncement(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: pinned.id, input: { pinned: true } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidated).toContainEqual(announcementKeys.lists());
    expect(
      queryClient.getQueryData(announcementKeys.detail(pinned.id)),
    ).toEqual(pinned);
  });
});

describe("useDeleteAnnouncement", () => {
  it("removes the detail entry rather than invalidating it", async () => {
    // Invalidating would refetch an id the server has just stopped serving and
    // cache a 404 under it.
    remove.mockResolvedValue(undefined);
    const { wrapper, invalidated, removed } = harness();

    const { result } = renderHook(() => useDeleteAnnouncement(), { wrapper });
    await act(async () => {
      result.current.mutate("68b0000000000000000000a1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(removed).toContainEqual(
      announcementKeys.detail("68b0000000000000000000a1"),
    );
    expect(invalidated).not.toContainEqual(
      announcementKeys.detail("68b0000000000000000000a1"),
    );
    expect(invalidated).toContainEqual(announcementKeys.lists());
    // The cover went with it.
    expect(invalidated).toContainEqual(uploadKeys.lists());
  });
});
