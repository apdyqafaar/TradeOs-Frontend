import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { UploadStep } from "./upload-step";

const upload = vi.fn();
vi.mock("@/features/product-import/hooks/use-import-mutations", () => ({
  useUploadImport: () => upload(),
}));

const downloadTemplate = vi.fn();
vi.mock("@/features/product-import/services/import.service", () => ({
  downloadTemplate: () => downloadTemplate(),
}));

const mutate = vi.fn();
const reset = vi.fn();
const onUploaded = vi.fn();

/** A `File` whose `size` is a lie, so the 5 MB rule is testable in a millisecond. */
const file = (name: string, bytes = 512): File => {
  const made = new File(["Name,Price\nRice,10\n"], name, { type: "text/csv" });
  Object.defineProperty(made, "size", { value: bytes });
  return made;
};

beforeEach(() => {
  mutate.mockReset();
  reset.mockReset();
  onUploaded.mockReset();
  downloadTemplate.mockReset();
  upload.mockReturnValue({
    mutate,
    reset,
    isPending: false,
    error: null,
  });
});

describe("UploadStep", () => {
  it("draws the design's drop zone copy and the size rule beneath it", () => {
    render(<UploadStep onUploaded={onUploaded} />);

    expect(screen.getByText("Drop a CSV or XLSX here")).toBeInTheDocument();
    expect(screen.getByText(/up to 2,000 rows · 5 MB/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download template/i }),
    ).toBeInTheDocument();
  });

  /**
   * The whole point of the `<input type="file">` rather than a clickable div:
   * a keyboard and a screen reader can both reach it. `getByLabelText` only
   * finds it if it is labelled and still in the accessibility tree, so a
   * regression to `display:none` or `hidden` turns this red.
   */
  it("exposes a real, labelled file input rather than a clickable div", () => {
    render(<UploadStep onUploaded={onUploaded} />);

    const input = screen.getByLabelText(/drop a csv or xlsx here/i);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", expect.stringContaining(".xlsx"));
  });

  it("sends a chosen CSV and hands the new job id to the wizard", async () => {
    mutate.mockImplementation(
      (_file: File, options: { onSuccess: (job: { id: string }) => void }) => {
        options.onSuccess({ id: "6512ab34cd56ef7890123456" });
      },
    );

    render(<UploadStep onUploaded={onUploaded} />);
    await userEvent.upload(
      screen.getByLabelText(/drop a csv or xlsx here/i),
      file("stock.csv"),
    );

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith("6512ab34cd56ef7890123456");
  });

  /**
   * The server has **no `fileFilter`**: a `.pdf` is parsed as CSV and comes
   * back as `IMPORT_NO_ROWS`, which reads as "your file is empty" about a file
   * that is not empty at all. The courtesy check is what produces the sentence
   * that names the real problem, and it must not spend an upload to do it.
   */
  it("refuses a file we cannot read without spending an upload", async () => {
    render(<UploadStep onUploaded={onUploaded} />);
    await userEvent.upload(
      screen.getByLabelText(/drop a csv or xlsx here/i),
      file("catalogue.pdf"),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /\.csv and \.xlsx files/i,
    );
  });

  it("refuses a file over 5 MB before the bytes leave the browser", async () => {
    render(<UploadStep onUploaded={onUploaded} />);
    await userEvent.upload(
      screen.getByLabelText(/drop a csv or xlsx here/i),
      file("everything.xlsx", 6 * 1024 * 1024),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/over 5 MB/i);
  });

  /**
   * `IMPORT_NO_ROWS` is the refusal a `.xls`, a `.txt` and a `.pdf` all
   * produce, so its own message is the wrong sentence more often than it is
   * the right one. The copy is ours, branched on `code`; the request id stays
   * the API's, because it is the only thing support can trace.
   */
  it("says what IMPORT_NO_ROWS actually means, and keeps the request id", () => {
    upload.mockReturnValue({
      mutate,
      reset,
      isPending: false,
      error: new ApiError({
        message: "No rows found",
        status: 422,
        code: API_ERROR_CODE.IMPORT_NO_ROWS,
        requestId: "req-77",
      }),
    });

    render(<UploadStep onUploaded={onUploaded} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /may not be a spreadsheet at all/i,
    );
    expect(screen.getByText(/Request ID: req-77/)).toBeInTheDocument();
  });

  it("explains that the upload limit is spent by the whole business", () => {
    upload.mockReturnValue({
      mutate,
      reset,
      isPending: false,
      error: new ApiError({
        message: "Too many attempts. Try again in 400 seconds.",
        status: 429,
        code: API_ERROR_CODE.TOO_MANY_REQUESTS,
      }),
    });

    render(<UploadStep onUploaded={onUploaded} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/this business/i);
  });

  /**
   * `GET /template` answers raw `text/csv` with no JSON envelope, so it cannot
   * go through the shared axios client. This asserts the service function is
   * what gets called — a regression that routed it through `apiGet` would
   * throw `UNEXPECTED_RESPONSE` in production and pass every other test here.
   */
  it("fetches the template through the non-JSON service and reports a failure", async () => {
    downloadTemplate.mockRejectedValue(
      new ApiError({
        message: "Could not download the template.",
        status: 500,
        code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
        requestId: "req-91",
      }),
    );

    render(<UploadStep onUploaded={onUploaded} />);
    await userEvent.click(
      screen.getByRole("button", { name: /download template/i }),
    );

    expect(downloadTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Request ID: req-91/)).toBeInTheDocument();
  });
});
