import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Announcement } from "../types";
import { AnnouncementFormSheet } from "./announcement-form-sheet";

const createMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock("../hooks/use-announcement-mutations", () => ({
  useCreateAnnouncement: () => ({ mutate: createMutate, isPending: false }),
  useUpdateAnnouncement: () => ({ mutate: updateMutate, isPending: false }),
}));

const granted = new Set<string>();
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (...required: string[]) => required.every((p) => granted.has(p)),
}));

/**
 * The real `<ImagePicker>` owns two query hooks of its own and has its own
 * spec. Stubbed here to a control that reports whether it was rendered at all —
 * which is the only thing this form decides about it.
 */
vi.mock("@/features/uploads/components/image-picker", () => ({
  ImagePicker: ({ value }: { value: string[] }) => (
    <div data-testid="image-picker" data-value={value.join(",")} />
  ),
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

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  onOpenChange.mockReset();
  granted.clear();
  granted.add("uploads:create");
});

const openCreate = () =>
  render(<AnnouncementFormSheet open onOpenChange={onOpenChange} />);

const openEdit = (announcement = row()) =>
  render(
    <AnnouncementFormSheet
      open
      onOpenChange={onOpenChange}
      announcement={announcement}
    />,
  );

describe("AnnouncementFormSheet — creating", () => {
  it("sends title, body and the pinned default, with no cover key", async () => {
    // `coverUploadId` is omitted rather than sent as `null`: `null` is legal on
    // create but means "delete the cover", which is untrue of a row that has
    // none.
    openCreate();

    await userEvent.type(
      screen.getByLabelText("Title"),
      "Prices change Monday",
    );
    await userEvent.type(
      screen.getByLabelText("Announcement"),
      "New sugar price from Monday.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Post announcement" }),
    );

    expect(createMutate).toHaveBeenCalledWith(
      {
        title: "Prices change Monday",
        body: "New sugar price from Monday.",
        pinned: false,
      },
      expect.anything(),
    );
  });

  it("carries pinned:true when the box is ticked", async () => {
    openCreate();

    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Announcement"), "B");
    await userEvent.click(screen.getByLabelText(/Pin to the top/));
    await userEvent.click(
      screen.getByRole("button", { name: "Post announcement" }),
    );

    expect(createMutate).toHaveBeenCalledWith(
      { title: "T", body: "B", pinned: true },
      expect.anything(),
    );
  });

  it("refuses an empty body at the control rather than posting a 422", async () => {
    openCreate();

    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.click(
      screen.getByRole("button", { name: "Post announcement" }),
    );

    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write something to announce",
    );
  });

  it("hides the image picker from a member without uploads:create", () => {
    // All three upload routes are gated on `uploads:create` and there is no
    // `uploads:view`, so a role that cannot upload cannot list the gallery
    // either. Hidden, not disabled.
    granted.delete("uploads:create");
    openCreate();
    expect(screen.queryByTestId("image-picker")).not.toBeInTheDocument();
  });

  it("shows the image picker to a member who may upload", () => {
    openCreate();
    expect(screen.getByTestId("image-picker")).toBeInTheDocument();
  });
});

describe("AnnouncementFormSheet — editing", () => {
  it("closes without sending anything when nothing changed", async () => {
    // The reason `announcementPatch` returns null: `PATCH {}` is a deliberate
    // 422 whose message arrives under the field key `"_"`, which would tell the
    // user off for a form they believe they left alone.
    openEdit();

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateMutate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends only the field that moved", async () => {
    openEdit();

    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Stock take Sunday");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: "68b0000000000000000000a1",
        input: { title: "Stock take Sunday" },
      },
      expect.anything(),
    );
  });

  it("sends pinned:false when the box is unticked", async () => {
    openEdit(row({ pinned: true }));

    await userEvent.click(screen.getByLabelText(/Pin to the top/));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateMutate).toHaveBeenCalledWith(
      { id: "68b0000000000000000000a1", input: { pinned: false } },
      expect.anything(),
    );
  });

  it("hands the saved cover to the picker, which cannot look it up itself", () => {
    // The gallery lists UNATTACHED uploads and this cover is attached, so
    // without `known` it would render as an empty placeholder tile.
    const cover = {
      uploadId: "68b0000000000000000000c1",
      url: "https://cdn/x.webp",
      thumbUrl: "https://cdn/x-t.webp",
    };
    openEdit(row({ cover }));

    expect(screen.getByTestId("image-picker")).toHaveAttribute(
      "data-value",
      "68b0000000000000000000c1",
    );
  });

  it("warns that replacing a cover destroys the old image", () => {
    openEdit(
      row({
        cover: {
          uploadId: "68b0000000000000000000c1",
          url: "https://cdn/x.webp",
          thumbUrl: "https://cdn/x-t.webp",
        },
      }),
    );

    expect(
      screen.getByText(/deletes the image\s+permanently/),
    ).toBeInTheDocument();
  });
});

describe("AnnouncementFormSheet — refusals", () => {
  it('routes the body-level 422 under "_" to the form panel instead of dropping it', async () => {
    // An object-level zod issue has an empty path and `zodToFieldErrors` names
    // it `"_"`. Without a row for that key, this message would be looked up
    // against a control called `_`, find nothing, and vanish.
    updateMutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Validation failed",
          status: 422,
          code: "VALIDATION_ERROR",
          fieldErrors: { _: "At least one field must be provided" },
        }),
      );
    });
    openEdit();

    const title = screen.getByLabelText("Title");
    await userEvent.type(title, "!");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "At least one field must be provided",
    );
  });

  it("shows a wrong-purpose upload at the cover control", async () => {
    createMutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Upload purpose does not match this resource",
          status: 409,
          code: "UPLOAD_PURPOSE_MISMATCH",
        }),
      );
    });
    openCreate();

    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Announcement"), "B");
    await userEvent.click(
      screen.getByRole("button", { name: "Post announcement" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That image was uploaded for something else",
    );
  });

  it("surfaces a refusal it has no control for rather than staying silent", async () => {
    // A 403 from a role that changed mid-session has no field to blame. Silence
    // here is how a form becomes un-submittable for a reason nobody can see.
    createMutate.mockImplementation((_vars, options) => {
      options.onError(
        new ApiError({
          message: "You do not have permission to do that",
          status: 403,
          code: "FORBIDDEN",
        }),
      );
    });
    openCreate();

    await userEvent.type(screen.getByLabelText("Title"), "T");
    await userEvent.type(screen.getByLabelText("Announcement"), "B");
    await userEvent.click(
      screen.getByRole("button", { name: "Post announcement" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to do that",
    );
  });
});
