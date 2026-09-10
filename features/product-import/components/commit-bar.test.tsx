import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { ImportJobSummary, ImportRow } from "../types";
import { CommitBar } from "./commit-bar";

const conflictsQuery = vi.fn();
vi.mock("../hooks/use-import-job", () => ({
  useImportJobConflicts: (id: string, page: number) => conflictsQuery(id, page),
}));

const commitMutate = vi.fn();
vi.mock("../hooks/use-import-mutations", () => ({
  useCommitImport: () => ({ mutate: commitMutate, isPending: false }),
}));

let granted = true;
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => granted,
}));

const JOB_ID = "68c1f0a4e2b9c7d3a1f40b21";

const job = (over: Partial<ImportJobSummary> = {}): ImportJobSummary => ({
  id: JOB_ID,
  status: "reviewing",
  filename: "catalogue.csv",
  format: "csv",
  columnMap: {
    name: "Name",
    barcode: "SKU",
    category: null,
    unit: null,
    costPrice: "Cost",
    sellingPrice: "Price",
    quantity: null,
    lowStockThreshold: null,
    trackStock: null,
    description: null,
  },
  unmatchedHeaders: [],
  totalRows: 195,
  counts: { ready: 184, needsAttention: 6, conflict: 3, skipped: 2 },
  expiresAt: "2026-09-17T10:00:00.000Z",
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
  ...over,
});

const conflictRow = (
  index: number,
  resolution?: "skip" | "update",
): ImportRow => ({
  index,
  raw: {},
  parsed: { name: `Row ${index}`, barcode: `600123456789${index}` },
  status: "conflict",
  errors: {},
  notes: [],
  conflict: {
    existingProductId: "6aa178be2f7394082d889c7b",
    existingName: "Basmati rice 5 kg",
    ...(resolution ? { resolution } : {}),
  },
});

/**
 * One settled page of conflicts. Built once per test and handed back by
 * reference, because the accumulator in `CommitBar` keys its effect off
 * `query.data` — React Query hands back a stable reference between renders and
 * a mock that built a fresh object per call would not be modelling it.
 */
const conflictsPage = (rows: ImportRow[], totalPages = 1) => ({
  data: {
    ...job(),
    rows,
    rowsMeta: { page: 1, limit: 200, total: rows.length, totalPages },
  },
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
});

const stillLoading = {
  data: undefined,
  error: null,
  isPending: true,
  isFetching: true,
  refetch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  granted = true;
  conflictsQuery.mockReturnValue(conflictsPage([]));
});

describe("CommitBar — what the summary can and cannot prove", () => {
  it("renders 'not loaded yet' as checking, never as 'fix your rows'", () => {
    // `commitReadiness` refuses to answer while it holds fewer conflicted rows
    // than `counts.conflict` claims exist. That blocker means the client cannot
    // yet answer — the answer may well be yes — so it must not read like an
    // accusation (`docs/findings/slice4-import-data.md` §3).
    conflictsQuery.mockReturnValue(stillLoading);

    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          counts: { ready: 184, needsAttention: 0, conflict: 3, skipped: 2 },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByText(/Checking the conflicts/)).toBeInTheDocument();
    expect(screen.queryByText(/fix or skip/)).not.toBeInTheDocument();
  });

  it("shows the canvas's needs-attention sentence and blocks the button", () => {
    // `counts.needsAttention > 0` settles the "no" from the summary alone, so
    // the reviewer is told immediately rather than after a fetch.
    render(<CommitBar jobId={JOB_ID} job={job()} />);

    expect(
      screen.getByText(
        "6 rows still need attention — fix or skip them to enable the import.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  it("enables the import once every conflict has a decision", () => {
    conflictsQuery.mockReturnValue(
      conflictsPage([
        conflictRow(20, "update"),
        conflictRow(21, "skip"),
        conflictRow(22, "update"),
      ]),
    );

    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          counts: { ready: 184, needsAttention: 0, conflict: 3, skipped: 2 },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Import 184 products" }),
    ).toBeEnabled();
  });

  it("never gates on counts.conflict, which does not move when a conflict is resolved", () => {
    // `resolveConflict` writes `conflict.resolution` and leaves
    // `status: "conflict"` (`product-import.service.ts:434`), so this tally is
    // 3 both before and after the reviewer decides. A button gated on it would
    // be disabled for ever.
    conflictsQuery.mockReturnValue(
      conflictsPage([
        conflictRow(20, "update"),
        conflictRow(21, "skip"),
        conflictRow(22, "skip"),
      ]),
    );

    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          counts: { ready: 184, needsAttention: 0, conflict: 3, skipped: 2 },
        })}
      />,
    );

    expect(screen.getByText(/conflicts resolved/)).toHaveTextContent(
      "3 of 3 conflicts resolved",
    );
    expect(
      screen.getByRole("button", { name: "Import 184 products" }),
    ).toBeEnabled();
  });

  it("names the rows that still need a decision, in spreadsheet numbers", () => {
    conflictsQuery.mockReturnValue(
      conflictsPage([
        conflictRow(19),
        conflictRow(20, "skip"),
        conflictRow(21),
      ]),
    );

    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          counts: { ready: 184, needsAttention: 0, conflict: 3, skipped: 2 },
        })}
      />,
    );

    // index 19 and 21 are the spreadsheet's rows 21 and 23 (contract Trap 6).
    expect(screen.getByText(/rows 21, 23/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  it("predicts the 403 a row resolved 'update' would earn without products:update", () => {
    // The commit reads `products:update` off the caller's role and refuses
    // before the transaction opens, so the wizard can block at the step where
    // the decision was made rather than at the very end.
    granted = false;
    conflictsQuery.mockReturnValue(conflictsPage([conflictRow(20, "update")]));

    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          counts: { ready: 184, needsAttention: 0, conflict: 1, skipped: 2 },
        })}
      />,
    );

    expect(
      screen.getByText(/do not have permission to change products/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });
});

describe("CommitBar — a commit that writes nothing", () => {
  it("confirms rather than disabling, because the server accepts it", async () => {
    // Every row skipped is a legal commit: `{ created: 0, updated: 0, skipped: N }`
    // and the job is marked `committed`, irreversibly. Disabling a control the
    // server would accept is its own kind of lie.
    const user = userEvent.setup();
    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          totalRows: 25,
          counts: { ready: 0, needsAttention: 0, conflict: 0, skipped: 25 },
        })}
      />,
    );

    const button = screen.getByRole("button", { name: /^Import/ });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(
      screen.getByText("Finish an import that writes nothing?"),
    ).toBeInTheDocument();
    expect(commitMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Finish anyway" }));
    expect(commitMutate).toHaveBeenCalledWith(JOB_ID, expect.anything());
  });
});

describe("CommitBar — refusals", () => {
  const commitFailsWith = (error: ApiError) => {
    commitMutate.mockImplementation(
      (_id: string, options: { onError: (e: ApiError) => void }) =>
        options.onError(error),
    );
  };

  const ready = () =>
    job({ counts: { ready: 184, needsAttention: 0, conflict: 0, skipped: 2 } });

  it("shows the server's fresh counts off a 422 IMPORT_NOT_READY", async () => {
    // That refusal is the only one in the whole surface with a write side
    // effect — it re-flags rows, recomputes `counts` and saves *before*
    // throwing — so the numbers it carries are newer than the ones on screen.
    const user = userEvent.setup();
    commitFailsWith(
      new ApiError({
        message: "Import is not ready",
        status: 422,
        code: "IMPORT_NOT_READY",
        details: {
          counts: { ready: 180, needsAttention: 4, conflict: 0, skipped: 2 },
        },
      }),
    );

    render(<CommitBar jobId={JOB_ID} job={ready()} />);
    await user.click(
      screen.getByRole("button", { name: "Import 184 products" }),
    );

    expect(screen.getByText(/re-checked just now/)).toBeInTheDocument();
    // The summary and the button both read the server's post-refusal tally,
    // not the stale one the reviewer pressed against.
    expect(
      screen.getByRole("button", { name: "Import 180 products" }),
    ).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
  });

  it("names the row that lost the barcode race, and says nothing was written", async () => {
    const user = userEvent.setup();
    commitFailsWith(
      new ApiError({
        message: "A conflicting product changed",
        status: 409,
        code: "IMPORT_CONFLICT_CHANGED",
        details: { rowIndex: 19 },
      }),
    );

    render(<CommitBar jobId={JOB_ID} job={ready()} />);
    await user.click(
      screen.getByRole("button", { name: "Import 184 products" }),
    );

    // index 19 is the spreadsheet's row 21, and the whole transaction rolled
    // back — zero products, zero stock movements.
    expect(screen.getByRole("alert")).toHaveTextContent("Row 21");
    expect(screen.getByRole("alert")).toHaveTextContent(/rolled back/);
  });

  it("says someone else finished it on a 409 IMPORT_NOT_REVIEWING", async () => {
    const user = userEvent.setup();
    commitFailsWith(
      new ApiError({
        message: "Import job is not in review",
        status: 409,
        code: "IMPORT_NOT_REVIEWING",
      }),
    );

    render(<CommitBar jobId={JOB_ID} job={ready()} />);
    await user.click(
      screen.getByRole("button", { name: "Import 184 products" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /already been committed or cancelled/,
    );
  });
});

describe("CommitBar — after the commit", () => {
  it("reads as a receipt once the job is committed", () => {
    render(
      <CommitBar
        jobId={JOB_ID}
        job={job({
          status: "committed",
          counts: { ready: 184, needsAttention: 0, conflict: 3, skipped: 2 },
          result: { created: 184, updated: 2, skipped: 3 },
        })}
      />,
    );

    expect(screen.getByText(/created/)).toHaveTextContent(
      "184 created · 2 updated · 3 skipped",
    );
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
  });

  it("says a cancelled import wrote nothing", () => {
    render(<CommitBar jobId={JOB_ID} job={job({ status: "cancelled" })} />);

    expect(
      screen.getByText("This import was cancelled. Nothing was written."),
    ).toBeInTheDocument();
  });
});
