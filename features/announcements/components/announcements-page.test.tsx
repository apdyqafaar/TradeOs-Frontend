import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Announcement } from "../types";
import { AnnouncementsPage } from "./announcements-page";

const listQuery = vi.fn();
vi.mock("../hooks/use-announcements", () => ({
  useAnnouncements: (params: unknown) => listQuery(params),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/**
 * `useCan` reads the session through React Query, so left real it would need a
 * `QueryClientProvider` around every render in this file — a provider whose
 * only job would be to answer a permission question the tests already state
 * outright.
 */
const can = vi.fn(() => true);
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => can(),
}));

/**
 * The form sheet is stubbed: it owns an `<ImagePicker>` with two query hooks of
 * its own, and this file is about the feed, not about composing. Its own spec
 * exercises the real thing.
 */
vi.mock("./announcement-form-sheet", () => ({
  AnnouncementFormSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="form-sheet" /> : null,
}));

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

const answered = (
  items: Announcement[],
  meta: Partial<{ page: number; totalPages: number; total: number }> = {},
) => ({
  data: {
    items,
    meta: {
      page: 1,
      limit: 20,
      total: items.length,
      totalPages: 1,
      ...meta,
    },
  },
  error: null,
  isPending: false,
  isPlaceholderData: false,
  refetch: vi.fn(),
});

const failed = (error: ApiError) => ({
  data: undefined,
  error,
  isPending: false,
  isPlaceholderData: false,
  refetch: vi.fn(),
});

const renderPage = (search = "") =>
  render(<AnnouncementsPage />, {
    // `hasMemory` matters: without it the adapter freezes the search params, so
    // a `setFilters` call updates nothing and a paging test would assert the
    // old query while passing.
    wrapper: withNuqsTestingAdapter({ searchParams: search, hasMemory: true }),
  });

beforeEach(() => {
  listQuery.mockReset();
  listQuery.mockReturnValue(answered([row()]));
  can.mockReturnValue(true);
  push.mockReset();
});

describe("AnnouncementsPage", () => {
  it("asks for page 1 and nothing else — the query has two keys and no search", () => {
    // `listAnnouncementsQuerySchema` is `.strict()` with only `page` and
    // `limit`, so a third key would be a 422 rather than an ignored param.
    renderPage();
    expect(listQuery).toHaveBeenCalledWith({ page: 1 });
  });

  it("reads the page out of the URL, so a shared link opens the same page", () => {
    renderPage("?page=3");
    expect(listQuery).toHaveBeenCalledWith({ page: 3 });
  });

  it("renders no search box, because the API would 422 on one", () => {
    renderPage();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("counts notices beside the title", () => {
    listQuery.mockReturnValue(answered([row()], { total: 12 }));
    renderPage();
    expect(screen.getByText("12 notices")).toBeInTheDocument();
  });

  it("hides the create control from a member without announcements:create", () => {
    // Hidden, never disabled (brief §1.1). The Seller preset holds
    // `announcements:view` and none of the write permissions.
    can.mockReturnValue(false);
    renderPage();
    expect(
      screen.queryByRole("button", { name: /New announcement/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the create control to a member who holds it", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: /New announcement/ }),
    ).toBeInTheDocument();
  });

  it("shows the request id when the list fails", () => {
    // brief §8.4: the request id is the only thing linking what the user saw to
    // the server's log line, and it is the first thing support asks for.
    listQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Something went wrong",
          status: 500,
          code: "INTERNAL_SERVER_ERROR",
          requestId: "req_9f2",
        }),
      ),
    );
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText(/req_9f2/)).toBeInTheDocument();
  });

  it("renders the error card alone rather than an empty feed under it", () => {
    // An empty feed under an error reads as "nobody has posted anything" rather
    // than "we could not ask" — the wrong thing to tell someone looking for the
    // notice they were told to read.
    listQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Network error",
          status: 0,
          code: "NETWORK_ERROR",
        }),
      ),
    );
    renderPage();

    expect(screen.queryByText("No announcements yet")).not.toBeInTheDocument();
  });

  it("refuses the page on a 403 instead of showing an error card", () => {
    // Should be unreachable — every preset holds `announcements:view` — so this
    // means a custom role was built without it.
    listQuery.mockReturnValue(
      failed(new ApiError({ message: "Nope", status: 403, code: "FORBIDDEN" })),
    );
    renderPage();

    expect(
      screen.getByText("You don't have access to this"),
    ).toBeInTheDocument();
  });

  it("offers the create action from the empty state, to whoever may use it", () => {
    listQuery.mockReturnValue(answered([]));
    renderPage();

    expect(screen.getByText("No announcements yet")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /New announcement/ }).length,
    ).toBeGreaterThan(0);
  });

  it("offers no create action in the empty state to someone who cannot create", () => {
    can.mockReturnValue(false);
    listQuery.mockReturnValue(answered([]));
    renderPage();

    expect(screen.getByText("No announcements yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /New announcement/ }),
    ).not.toBeInTheDocument();
  });

  it("says something different when a later page came back empty", () => {
    // Not "nothing has ever been posted" — rows were deleted while this page
    // was open, and the fix is going back to the newest.
    listQuery.mockReturnValue(answered([], { page: 2, totalPages: 2 }));
    renderPage("?page=2");

    expect(screen.getByText("Nothing on this page")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to the newest" }),
    ).toBeInTheDocument();
  });

  it("hides the pager on a single page", () => {
    renderPage();
    expect(
      screen.queryByRole("navigation", { name: "Announcement pages" }),
    ).not.toBeInTheDocument();
  });

  it("pages with Newer and Older, disabling the edge", () => {
    listQuery.mockReturnValue(answered([row()], { page: 1, totalPages: 3 }));
    renderPage();

    expect(screen.getByRole("button", { name: /Newer/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Older/ })).toBeEnabled();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });
});
