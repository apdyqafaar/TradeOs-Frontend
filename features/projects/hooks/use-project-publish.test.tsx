import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectKeys } from "../keys";
import {
  clearShareTokens,
  getShareToken,
  rememberShareToken,
} from "../share-token-store";
import {
  usePublishProject,
  useRegenerateShareLink,
  useUnpublishProject,
} from "./use-project-publish";

const publish = vi.fn();
const unpublish = vi.fn();
const regenerateLink = vi.fn();
vi.mock("../services/project.service", () => ({
  publish: (...args: unknown[]) => publish(...args),
  unpublish: (...args: unknown[]) => unpublish(...args),
  regenerateLink: (...args: unknown[]) => regenerateLink(...args),
}));

const ID = "68b0000000000000000000a1";
const FIRST = "a".repeat(64);
const SECOND = "b".repeat(64);

/** The keys each mutation asked to be refetched, in the order it asked. */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];

  const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return realInvalidate(filters as never);
  }) as typeof queryClient.invalidateQueries;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper, invalidated };
}

beforeEach(() => {
  publish.mockReset();
  unpublish.mockReset();
  regenerateLink.mockReset();
  clearShareTokens();
});

describe("usePublishProject", () => {
  it("captures the token — the only moment the API will ever say it", async () => {
    publish.mockResolvedValue({
      shareToken: FIRST,
      isPublished: true,
      publishedAt: "2026-09-10T09:00:00.000Z",
    });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => usePublishProject(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getShareToken(ID)).toBe(FIRST);
    expect(invalidated).toContainEqual(projectKeys.detail(ID));
    // The grid draws its "Published" pill from `isPublished`.
    expect(invalidated).toContainEqual(projectKeys.lists());
  });

  it("never writes a null token over one this tab is already holding", async () => {
    // The re-publish case. The hash was reused, so the server answers `null` —
    // but the value this browser captured on the FIRST publish is still the
    // only copy of that link in existence. Erasing it would destroy it.
    rememberShareToken(ID, FIRST);
    publish.mockResolvedValue({
      shareToken: null,
      isPublished: true,
      publishedAt: "2026-09-10T09:00:00.000Z",
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => usePublishProject(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getShareToken(ID)).toBe(FIRST);
  });

  it("stores nothing when a null token arrives and nothing was held", async () => {
    publish.mockResolvedValue({
      shareToken: null,
      isPublished: true,
      publishedAt: null,
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => usePublishProject(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Not `""`, not `"null"` — the card must be able to tell "published but
    // unshowable" from "here is the link".
    expect(getShareToken(ID)).toBeUndefined();
  });
});

describe("useUnpublishProject", () => {
  it("drops the token, because the link it holds is dead immediately", async () => {
    rememberShareToken(ID, FIRST);
    unpublish.mockResolvedValue({ isPublished: false });
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useUnpublishProject(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The public lookup filters on `isPublished: true` with no cache and no
    // grace period, so a Copy button still offering that URL would hand a
    // client a 404.
    expect(getShareToken(ID)).toBeUndefined();
    expect(invalidated).toContainEqual(projectKeys.detail(ID));
  });
});

describe("useRegenerateShareLink", () => {
  it("replaces the held token with the new one", async () => {
    rememberShareToken(ID, FIRST);
    regenerateLink.mockResolvedValue({
      shareToken: SECOND,
      isPublished: true,
      publishedAt: "2026-09-10T10:00:00.000Z",
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useRegenerateShareLink(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getShareToken(ID)).toBe(SECOND);
  });

  it("forgets rather than keeping a stale token if the shape surprises us", async () => {
    // This route always mints, so `null` should be unreachable. If it ever is
    // not, showing the OLD link would be worse than showing none: regenerating
    // has already killed it server-side.
    rememberShareToken(ID, FIRST);
    regenerateLink.mockResolvedValue({
      shareToken: null,
      isPublished: true,
      publishedAt: null,
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useRegenerateShareLink(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getShareToken(ID)).toBeUndefined();
  });
});
