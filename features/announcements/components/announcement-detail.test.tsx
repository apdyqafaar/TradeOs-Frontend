import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Announcement } from "../types";
import {
  AnnouncementDetail,
  initialsOf,
  paragraphsOf,
} from "./announcement-detail";

const detailQuery = vi.fn();
vi.mock("../hooks/use-announcement", () => ({
  useAnnouncement: (id: unknown) => detailQuery(id),
}));

const updateMutate = vi.fn();
vi.mock("../hooks/use-announcement-mutations", () => ({
  useUpdateAnnouncement: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}));

/**
 * Marking read is stubbed here so this file can assert the *wiring* — what the
 * screen hands the hook, and when. The four guards inside it (no row, no
 * permission, already read, already marked) are the hook's own spec, against
 * the axios adapter.
 */
const markReadOnView = vi.fn();
vi.mock("../hooks/use-announcement-unread", () => ({
  useMarkAnnouncementReadOnView: (announcement: unknown) =>
    markReadOnView(announcement),
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
 * Per-permission, not a single boolean: this screen asks two separate questions
 * — `announcements:update` for Pin and Edit, `announcements:delete` for Delete —
 * and the interesting cases are the ones where the answers differ.
 */
const granted = new Set<string>();
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (...required: string[]) => required.every((p) => granted.has(p)),
}));

/** Both write dialogs are stubbed; each has its own spec. */
vi.mock("./announcement-form-sheet", () => ({
  AnnouncementFormSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="form-sheet" /> : null,
}));
vi.mock("./delete-announcement-dialog", () => ({
  DeleteAnnouncementDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="delete-dialog" /> : null,
}));

const row = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: "68b0000000000000000000a1",
  title: "Stock take this Saturday",
  body: "We close the counter at 15:00.\n\nCount the grains aisle first.",
  pinned: false,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  author: { id: "68b0000000000000000000b1", name: "Amina Mohamed" },
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

const answered = (announcement: Announcement) => ({
  data: announcement,
  error: null,
  isPending: false,
  refetch: vi.fn(),
});

const failed = (error: ApiError) => ({
  data: undefined,
  error,
  isPending: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  detailQuery.mockReset();
  detailQuery.mockReturnValue(answered(row()));
  updateMutate.mockReset();
  markReadOnView.mockReset();
  push.mockReset();
  granted.clear();
  granted.add("announcements:update");
  granted.add("announcements:delete");
});

describe("initialsOf", () => {
  it("takes the first and last name", () => {
    expect(initialsOf("Amina Mohamed")).toBe("AM");
  });

  it("takes two letters from a single name", () => {
    expect(initialsOf("Amina")).toBe("AM");
  });

  it('survives the API\'s empty author, which is "" and not null', () => {
    // If `createdBy` fails to populate, `author` is `{ id: "", name: "" }` —
    // an empty string. An unguarded `name[0]` would render `undefined`.
    expect(initialsOf("")).toBe("—");
  });

  it("handles the API's own fallback name", () => {
    expect(initialsOf("Removed member")).toBe("RM");
  });
});

describe("paragraphsOf", () => {
  it("splits on blank lines", () => {
    expect(paragraphsOf("One.\n\nTwo.")).toEqual(["One.", "Two."]);
  });

  it("keeps a single newline inside a paragraph", () => {
    // Rendered with `whitespace-pre-line`, so a typed list survives.
    expect(paragraphsOf("Bring:\n- scanner\n- tablet")).toEqual([
      "Bring:\n- scanner\n- tablet",
    ]);
  });

  it("drops empty runs rather than rendering blank paragraphs", () => {
    expect(paragraphsOf("One.\n\n\n\nTwo.\n\n")).toEqual(["One.", "Two."]);
  });
});

describe("AnnouncementDetail", () => {
  it("names the author from the populated response, with no second request", () => {
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);
    expect(screen.getByText("Amina Mohamed")).toBeInTheDocument();
    expect(screen.getByText("AM")).toBeInTheDocument();
  });

  it("renders the body as paragraphs of text", () => {
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);
    expect(
      screen.getByText("We close the counter at 15:00."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Count the grains aisle first."),
    ).toBeInTheDocument();
  });

  it("marks a pinned notice", () => {
    detailQuery.mockReturnValue(answered(row({ pinned: true })));
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);
    expect(screen.getByText("Pinned")).toBeInTheDocument();
  });

  it("unpins with pinned:false — the value a truthiness filter would drop", async () => {
    // There is no `POST /unpin`: unpinning is `PATCH { pinned: false }`, and
    // `false` is a real value the body must carry (contract §2.3).
    detailQuery.mockReturnValue(answered(row({ pinned: true })));
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    await userEvent.click(screen.getByRole("button", { name: /Unpin/ }));

    expect(updateMutate).toHaveBeenCalledWith(
      { id: "68b0000000000000000000a1", input: { pinned: false } },
      expect.anything(),
    );
  });

  it("pins with pinned:true", async () => {
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    await userEvent.click(screen.getByRole("button", { name: /^Pin$/ }));

    expect(updateMutate).toHaveBeenCalledWith(
      { id: "68b0000000000000000000a1", input: { pinned: true } },
      expect.anything(),
    );
  });

  it("shows a failed pin at the control, not in a toast", async () => {
    updateMutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "This business is suspended",
          status: 403,
          code: "FORBIDDEN",
        }),
      );
    });
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    await userEvent.click(screen.getByRole("button", { name: /^Pin$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This business is suspended",
    );
  });

  it("hides Edit and Pin from a member without announcements:update", () => {
    // Hidden, never disabled. Editing is permission-based rather than
    // author-based, so this is the ONLY thing that hides it — never "not your
    // post" (contract trap 12).
    granted.delete("announcements:update");
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Pin$/ }),
    ).not.toBeInTheDocument();
  });

  it("shows Edit for somebody else's notice, because editing is not author-based", () => {
    detailQuery.mockReturnValue(
      answered(
        row({
          createdBy: "68b000000000000000000999",
          author: { id: "68b000000000000000000999", name: "Hodan Ali" },
        }),
      ),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("hides Delete from a member without announcements:delete", () => {
    granted.delete("announcements:delete");
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);
    expect(
      screen.queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  it("treats a 404 as an answer, not as an error to retry", () => {
    // This feature hard-deletes, so a link shared in a chat can genuinely point
    // at nothing. A red card with a request id would be the wrong register.
    detailQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Announcement not found",
          status: 404,
          code: "NOT_FOUND",
          requestId: "req_1",
        }),
      ),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(screen.getByText("This announcement is gone")).toBeInTheDocument();
    expect(screen.queryByText(/req_1/)).not.toBeInTheDocument();
  });

  it("shows the request id on any other failure", () => {
    detailQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Something went wrong",
          status: 500,
          code: "INTERNAL_SERVER_ERROR",
          requestId: "req_77",
        }),
      ),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(screen.getByText(/req_77/)).toBeInTheDocument();
  });

  it("refuses the page on a 403", () => {
    detailQuery.mockReturnValue(
      failed(new ApiError({ message: "Nope", status: 403, code: "FORBIDDEN" })),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(
      screen.getByText("You don't have access to this"),
    ).toBeInTheDocument();
  });

  it("marks an edited notice, so a changed body is not passed off as the original", () => {
    detailQuery.mockReturnValue(
      answered(row({ updatedAt: "2026-09-09T09:00:00.000Z" })),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(screen.getByText("· edited")).toBeInTheDocument();
  });

  it("does not claim an edit when updatedAt equals createdAt", () => {
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);
    expect(screen.queryByText("· edited")).not.toBeInTheDocument();
  });
});

describe("AnnouncementDetail — marking read", () => {
  it("hands the loaded row to the mark-read hook, not the id", () => {
    // The row rather than the id, so the hook can tell "shown to the reader"
    // from "asked for and refused".
    const announcement = row();
    detailQuery.mockReturnValue(answered(announcement));
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(markReadOnView).toHaveBeenCalledWith(announcement);
  });

  it("hands it nothing while the announcement is still loading", () => {
    detailQuery.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
      refetch: vi.fn(),
    });
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(markReadOnView).toHaveBeenCalledWith(undefined);
  });

  it("hands it nothing on a 404 — nothing was shown, so nothing was read", () => {
    detailQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Announcement not found",
          status: 404,
          code: "NOT_FOUND",
        }),
      ),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(markReadOnView).toHaveBeenCalledWith(undefined);
  });

  it("hands it nothing on a 403, and the hook is still called — hooks may not be conditional", () => {
    // The 403 branch returns before the article renders, so the call must be
    // above it. React would throw "rendered fewer hooks than expected" if this
    // ever moved below a conditional return.
    detailQuery.mockReturnValue(
      failed(new ApiError({ message: "Nope", status: 403, code: "FORBIDDEN" })),
    );
    render(<AnnouncementDetail announcementId="68b0000000000000000000a1" />);

    expect(markReadOnView).toHaveBeenCalledWith(undefined);
  });
});
