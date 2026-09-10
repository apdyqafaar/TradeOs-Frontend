import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Announcement } from "../types";
import { DeleteAnnouncementDialog } from "./delete-announcement-dialog";

const deleteMutate = vi.fn();
vi.mock("../hooks/use-announcement-mutations", () => ({
  useDeleteAnnouncement: () => ({ mutate: deleteMutate, isPending: false }),
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

const onOpenChange = vi.fn();
const onDeleted = vi.fn();

const open = (announcement = row()) =>
  render(
    <DeleteAnnouncementDialog
      announcement={announcement}
      open
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
    />,
  );

beforeEach(() => {
  deleteMutate.mockReset();
  onOpenChange.mockReset();
  onDeleted.mockReset();
});

describe("DeleteAnnouncementDialog", () => {
  it("names the notice in the question, so the wrong row is hard to delete", () => {
    open();
    expect(screen.getByText(/Stock take this Saturday/)).toBeInTheDocument();
  });

  it("says the delete is permanent, because it is a hard delete with no undo", () => {
    open();
    expect(screen.getByText(/cannot be brought back/)).toBeInTheDocument();
  });

  it("warns that the cover image goes too, but only when there is one", () => {
    open(
      row({
        cover: {
          uploadId: "68b0000000000000000000c1",
          url: "https://cdn/x.webp",
          thumbUrl: "https://cdn/x-t.webp",
        },
      }),
    );
    expect(
      screen.getByText(/cover image is deleted from storage/),
    ).toBeInTheDocument();
  });

  it("does not mention a cover on a notice without one", () => {
    open();
    expect(
      screen.queryByText(/cover image is deleted from storage/),
    ).not.toBeInTheDocument();
  });

  it("reports done on a 404 — already gone is the outcome it asked for", async () => {
    deleteMutate.mockImplementation((_id, options) => {
      options.onError(
        new ApiError({
          message: "Announcement not found",
          status: 404,
          code: "NOT_FOUND",
        }),
      );
    });
    open();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleted).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and says why on any other failure", async () => {
    deleteMutate.mockImplementation((_id, options) => {
      options.onError(
        new ApiError({
          message: "You do not have permission to do that",
          status: 403,
          code: "FORBIDDEN",
        }),
      );
    });
    open();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to do that",
    );
  });

  it("passes the id, since a 204 carries nothing to read it back from", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteMutate).toHaveBeenCalledWith(
      "68b0000000000000000000a1",
      expect.anything(),
    );
  });
});
