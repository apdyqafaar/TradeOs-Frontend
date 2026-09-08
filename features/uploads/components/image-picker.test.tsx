import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "@/lib/api/errors";
import { ImagePicker } from "./image-picker";

const uploads = vi.fn();
const create = vi.fn();
const remove = vi.fn();

/**
 * Mutation state the mocked hooks read at render time. A plain `let` captured
 * by the hoisted `vi.mock` factory would be read before it is initialised.
 */
const mutation: { createError: ApiError | null } = { createError: null };

vi.mock("@/features/uploads/hooks/use-uploads", () => ({
  useUploads: () => uploads(),
}));
vi.mock("@/features/uploads/hooks/use-upload-mutations", () => ({
  useCreateUpload: () => ({
    mutate: create,
    isPending: false,
    error: mutation.createError,
  }),
  useDeleteUpload: () => ({
    mutate: remove,
    isPending: false,
    error: null,
    variables: undefined,
  }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

/**
 * The gallery's real shape. `GET /uploads` is paginated, so the hook resolves
 * to `{ items, meta }` — the plan's draft mocked a bare array, which would let
 * the component read `.items` off nothing and still pass.
 */
const gallery = (items: unknown[] = []) => ({
  isPending: false,
  error: null,
  data: {
    items,
    meta: { page: 1, limit: 24, total: items.length, totalPages: 1 },
  },
});

/** Enough of an `ApiError` for a component that branches on `code`. */
const apiError = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => ({ status, code, message, details }) as unknown as ApiError;

beforeEach(() => {
  uploads.mockReset();
  create.mockReset();
  remove.mockReset();
  mutation.createError = null;
});

describe("ImagePicker", () => {
  it("stops accepting uploads once max images are chosen", () => {
    uploads.mockReturnValue(gallery());
    render(
      wrap(
        <ImagePicker
          purpose="product"
          max={5}
          value={["u1", "u2", "u3", "u4", "u5"]}
          onChange={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/5 of 5/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add image/i)).not.toBeInTheDocument();
  });

  it("explains itself instead of breaking when storage is not configured", () => {
    // `getStorage()` returns null without S3 keys and `POST /uploads` answers
    // 503 STORAGE_NOT_CONFIGURED. A dev machine hits this constantly, so it is
    // an explanation, not an error card.
    uploads.mockReturnValue({
      isPending: false,
      data: undefined,
      error: apiError(
        503,
        "STORAGE_NOT_CONFIGURED",
        "Image storage is not configured",
      ),
    });
    render(
      wrap(<ImagePicker purpose="product" value={[]} onChange={vi.fn()} />),
    );
    expect(
      screen.getByText(/image uploads are not set up/i),
    ).toBeInTheDocument();
  });

  it("reports ids in the new display order, because order is what a form stores", async () => {
    // `value` is upload ids in display order and `onChange` hands back the new
    // order — the product form sends exactly this array as `images`.
    uploads.mockReturnValue(gallery());
    const onChange = vi.fn();
    render(
      wrap(
        <ImagePicker
          purpose="product"
          value={["u1", "u2"]}
          onChange={onChange}
        />,
      ),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /move image 2 earlier/i }),
    );
    expect(onChange).toHaveBeenCalledWith(["u2", "u1"]);
  });

  it("refuses a HEIC photo in the browser and says what to do about it", () => {
    // What an iPhone shoots by default. `accept` does not apply to a dropped
    // file, so this is the path a HEIC actually arrives on — and the API would
    // answer 422 UNSUPPORTED_IMAGE after uploading the whole thing.
    uploads.mockReturnValue(gallery());
    render(
      wrap(<ImagePicker purpose="product" value={[]} onChange={vi.fn()} />),
    );

    fireEvent.drop(screen.getByRole("group", { name: /images/i }), {
      dataTransfer: {
        files: [new File(["x"], "IMG_0042.HEIC", { type: "image/heic" })],
      },
    });

    expect(screen.getByText(/heic/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("sends a dropped image as the file and the purpose it was given", () => {
    uploads.mockReturnValue(gallery());
    const file = new File(["x"], "rice.png", { type: "image/png" });
    render(
      wrap(
        <ImagePicker purpose="announcement" value={[]} onChange={vi.fn()} />,
      ),
    );

    fireEvent.drop(screen.getByRole("group", { name: /images/i }), {
      dataTransfer: { files: [file] },
    });

    expect(create).toHaveBeenCalledWith(
      { file, purpose: "announcement" },
      expect.anything(),
    );
  });

  it("names the way out of the pending-upload limit", () => {
    // Five unattached uploads per member. Printing the code, or the message
    // alone, leaves someone stuck with no idea what to clear.
    uploads.mockReturnValue(gallery());
    mutation.createError = apiError(
      409,
      "UPLOAD_PENDING_LIMIT",
      "You have 5 uploaded images that are not attached to anything yet.",
      { pending: 5, max: 5 },
    );
    render(
      wrap(<ImagePicker purpose="product" value={[]} onChange={vi.fn()} />),
    );

    expect(screen.getByText(/attach or delete/i)).toBeInTheDocument();
  });
});
