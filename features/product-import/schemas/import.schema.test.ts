import { describe, expect, it } from "vitest";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import type { ImportCounts, ImportRow } from "../types";
import {
  type CommitReadinessInput,
  columnMapPatchSchema,
  commitReadiness,
  countsFromNotReadyError,
  importRowPatchSchema,
  resolveConflictSchema,
  rowIndexFromConflictChangedError,
  spreadsheetRowNumber,
} from "./import.schema";

describe("columnMapPatchSchema", () => {
  it("accepts a single-field patch — the remap is a merge, not a replacement", () => {
    expect(
      columnMapPatchSchema.safeParse({ columnMap: { sellingPrice: "Price" } })
        .success,
    ).toBe(true);
  });

  it("accepts null, which is the only way to free a header for another field", () => {
    const parsed = columnMapPatchSchema.safeParse({
      columnMap: { costPrice: null, sellingPrice: "Cost" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.columnMap.costPrice).toBeNull();
  });

  it("refuses an empty map, matching the backend's own refine", () => {
    expect(columnMapPatchSchema.safeParse({ columnMap: {} }).success).toBe(
      false,
    );
  });

  // Trap 8: an unknown PRODUCT FIELD is a plain VALIDATION_ERROR from the
  // service, not IMPORT_UNKNOWN_HEADER, so a caller branching on the import
  // code would drop it into the generic handler. Naming the ten keys here means
  // it never reaches the wire.
  it("refuses a key that is not one of the ten product fields", () => {
    expect(
      columnMapPatchSchema.safeParse({ columnMap: { colour: "Colour" } })
        .success,
    ).toBe(false);
  });

  it("refuses an unknown key beside columnMap — the body is strict", () => {
    expect(
      columnMapPatchSchema.safeParse({
        columnMap: { name: "Item" },
        replace: true,
      }).success,
    ).toBe(false);
  });

  it("holds the backend's bounds and trims, so a header can only fail for real", () => {
    expect(
      columnMapPatchSchema.safeParse({ columnMap: { name: "" } }).success,
    ).toBe(false);
    expect(
      columnMapPatchSchema.safeParse({ columnMap: { name: "h".repeat(201) } })
        .success,
    ).toBe(false);

    const parsed = columnMapPatchSchema.safeParse({
      columnMap: { name: "  Item Name  " },
    });
    expect(parsed.success && parsed.data.columnMap.name).toBe("Item Name");
  });
});

describe("importRowPatchSchema", () => {
  /**
   * THE regression test for this slice, and the reason the contract's Trap 1 is
   * stale. `importRowSchema` used to inherit `createProductSchema`'s defaults
   * through `.partial()`, so this exact patch parsed to
   * `{ sellingPrice: 12, unit: "pcs", trackStock: true, quantity: 0 }` and the
   * service spread all four over the row — resetting a product sold by the kg
   * to `pcs`, switching stock tracking on for a service line and zeroing a
   * quantity of 100. `Backend` commit `48c7205` re-declared the three fields
   * without their defaults; this pins that the mirror never re-grows them.
   */
  it("sends ONLY the field being changed — no unit, trackStock or quantity", () => {
    const parsed = importRowPatchSchema.safeParse({ sellingPrice: 12 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ sellingPrice: 12 });
  });

  // Same fix: the "Nothing to update" refine used to be vacuous because the
  // defaults had already made the object three keys wide before it ran, so an
  // empty PATCH returned 200 and was destructive. It is a real 422 now, keyed
  // in `errors` under "_" because the zod issue has an empty path.
  it("refuses an empty patch", () => {
    expect(importRowPatchSchema.safeParse({}).success).toBe(false);
  });

  it("refuses categoryId — the category is changed by NAME", () => {
    expect(
      importRowPatchSchema.safeParse({
        categoryId: "652f1a2b3c4d5e6f70819234",
      }).success,
    ).toBe(false);
    expect(importRowPatchSchema.safeParse({ images: [] }).success).toBe(false);
  });

  it("accepts a blank category, which is how a category is cleared", () => {
    const parsed = importRowPatchSchema.safeParse({ category: "" });
    expect(parsed.success && parsed.data.category).toBe("");
  });

  it("holds barcode's 4-character minimum and its charset", () => {
    expect(importRowPatchSchema.safeParse({ barcode: "BW5" }).success).toBe(
      false,
    );
    expect(importRowPatchSchema.safeParse({ barcode: "BW 500" }).success).toBe(
      false,
    );
    expect(
      importRowPatchSchema.safeParse({ barcode: "BW-500.a_1" }).success,
    ).toBe(true);
  });

  it("holds money at 2 decimals and quantity at 3, and allows a zero quantity", () => {
    expect(importRowPatchSchema.safeParse({ costPrice: 0.3 }).success).toBe(
      true,
    );
    expect(importRowPatchSchema.safeParse({ costPrice: 0.301 }).success).toBe(
      false,
    );
    expect(importRowPatchSchema.safeParse({ costPrice: -1 }).success).toBe(
      false,
    );
    expect(importRowPatchSchema.safeParse({ quantity: 0 }).success).toBe(true);
    expect(importRowPatchSchema.safeParse({ quantity: 1.25 }).success).toBe(
      true,
    );
    expect(importRowPatchSchema.safeParse({ quantity: 1.2345 }).success).toBe(
      false,
    );
  });

  it("holds lowStockThreshold as a whole number", () => {
    expect(
      importRowPatchSchema.safeParse({ lowStockThreshold: 20 }).success,
    ).toBe(true);
    expect(
      importRowPatchSchema.safeParse({ lowStockThreshold: 2.5 }).success,
    ).toBe(false);
  });
});

describe("resolveConflictSchema", () => {
  it("takes exactly skip or update, and requires one", () => {
    expect(
      resolveConflictSchema.safeParse({ resolution: "skip" }).success,
    ).toBe(true);
    expect(
      resolveConflictSchema.safeParse({ resolution: "update" }).success,
    ).toBe(true);
    expect(resolveConflictSchema.safeParse({}).success).toBe(false);
    expect(
      resolveConflictSchema.safeParse({ resolution: "create" }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */

const counts = (over: Partial<ImportCounts> = {}): ImportCounts => ({
  ready: 0,
  needsAttention: 0,
  conflict: 0,
  skipped: 0,
  ...over,
});

type ReadinessRow = CommitReadinessInput["rows"][number];

const conflictRow = (
  index: number,
  resolution?: "skip" | "update",
): ReadinessRow => ({
  index,
  status: "conflict",
  conflict: {
    existingProductId: "652f1a2b3c4d5e6f70819234",
    existingName: "Bottled Water 500ml",
    ...(resolution ? { resolution } : {}),
  },
});

describe("commitReadiness", () => {
  it("commits a plain job of ready rows with no conflicts and no rows in hand", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ ready: 6 }) },
      rows: [],
    });
    expect(readiness.canCommit).toBe(true);
    expect(readiness.blocker).toBeNull();
  });

  /**
   * The whole reason this helper exists. A resolved conflict keeps
   * `status: "conflict"` — `resolveConflict` writes only `conflict.resolution`
   * — so `counts.conflict` never falls however many decisions the user makes.
   * A Commit button gated on `counts.conflict === 0` stays disabled forever.
   */
  it("commits with counts.conflict > 0 once every conflict carries a resolution", () => {
    const job = {
      status: "reviewing" as const,
      counts: counts({ ready: 4, conflict: 2 }),
    };
    expect(job.counts.conflict).toBe(2);

    const readiness = commitReadiness({
      job,
      rows: [conflictRow(3, "update"), conflictRow(5, "skip")],
    });

    expect(readiness.canCommit).toBe(true);
    expect(readiness.unresolvedConflictIndexes).toEqual([]);
    expect(readiness.updateRowIndexes).toEqual([3]);
  });

  it("blocks on an unresolved conflict and names the rows", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ ready: 1, conflict: 2 }) },
      rows: [conflictRow(5, "skip"), conflictRow(3)],
    });

    expect(readiness.canCommit).toBe(false);
    expect(readiness.blocker).toEqual({
      reason: "unresolved_conflict",
      rowIndexes: [3],
    });
  });

  it("blocks on needsAttention from the summary alone, without any rows", () => {
    const readiness = commitReadiness({
      job: {
        status: "reviewing",
        counts: counts({ ready: 2, needsAttention: 3 }),
      },
      rows: [],
    });

    expect(readiness.blocker).toEqual({ reason: "needs_attention", count: 3 });
  });

  /**
   * The summary can prove a "no" but never a "yes": the server's second gate is
   * `conflictRows.some(r => !r.conflict?.resolution)`, which is per-row data
   * `publicJobSummary` does not carry. Refusing to guess is the point — a
   * caller renders this as "checking", not as "fix your rows".
   */
  it("refuses to answer while it holds fewer conflict rows than counts claims", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ ready: 1, conflict: 3 }) },
      rows: [conflictRow(1, "update")],
    });

    expect(readiness.canCommit).toBe(false);
    expect(readiness.blocker).toEqual({
      reason: "conflicts_not_loaded",
      loaded: 1,
      expected: 3,
    });
  });

  it("de-duplicates rows by index, so accumulated pages can be passed straight in", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ ready: 1, conflict: 2 }) },
      rows: [
        conflictRow(1, "update"),
        conflictRow(1, "update"),
        conflictRow(4, "skip"),
      ],
    });

    expect(readiness.canCommit).toBe(true);
    expect(readiness.updateRowIndexes).toEqual([1]);
  });

  // Contract §14 marks it unverified that clearing a conflict actually removes
  // the stored field, and says to key the UI off `status`. A row that is no
  // longer in conflict must not be able to block a commit with a leftover.
  it("ignores a stale conflict object on a row whose status is not conflict", () => {
    const stale: ReadinessRow = {
      index: 2,
      status: "ready",
      conflict: {
        existingProductId: "652f1a2b3c4d5e6f70819234",
        existingName: "Bottled Water 500ml",
      },
    };

    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ ready: 3 }) },
      rows: [stale],
    });

    expect(readiness.canCommit).toBe(true);
  });

  it("blocks a committed or cancelled job before anything else", () => {
    for (const status of ["committed", "cancelled"] as const) {
      const readiness = commitReadiness({
        job: { status, counts: counts({ ready: 4, needsAttention: 9 }) },
        rows: [],
      });
      expect(readiness.blocker).toEqual({ reason: "not_reviewing", status });
    }
  });

  // The commit reads products:update off the caller's role and refuses with a
  // 403 before the transaction opens. Predicting it here is the difference
  // between a disabled button with a reason and a wizard that fails at the end.
  it("blocks an update-resolved row when the caller lacks products:update", () => {
    const input = {
      job: { status: "reviewing" as const, counts: counts({ conflict: 2 }) },
      rows: [conflictRow(0, "update"), conflictRow(1, "skip")],
    };

    expect(
      commitReadiness({ ...input, canUpdateProducts: false }).blocker,
    ).toEqual({ reason: "missing_products_update", rowIndexes: [0] });

    // Only "update" needs the permission; a job of pure skips does not.
    expect(
      commitReadiness({
        job: { status: "reviewing", counts: counts({ ready: 1, conflict: 1 }) },
        rows: [conflictRow(0, "skip")],
        canUpdateProducts: false,
      }).canCommit,
    ).toBe(true);

    // Unknown permission (a session still loading) must not invent a refusal.
    expect(commitReadiness(input).canCommit).toBe(true);
  });

  /**
   * The server accepts a commit where every row is skipped and writes nothing,
   * marking the job `committed` irreversibly. Reporting that as a blocker would
   * disable a control the server would accept, so it is advisory instead.
   */
  it("flags a commit that would write nothing without blocking it", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ skipped: 6 }) },
      rows: [],
    });

    expect(readiness.canCommit).toBe(true);
    expect(readiness.commitsNothing).toBe(true);

    expect(
      commitReadiness({
        job: { status: "reviewing", counts: counts({ ready: 1, skipped: 5 }) },
        rows: [],
      }).commitsNothing,
    ).toBe(false);
  });

  it("never claims commitsNothing while the conflict rows are unknown", () => {
    const readiness = commitReadiness({
      job: { status: "reviewing", counts: counts({ conflict: 2 }) },
      rows: [],
    });

    expect(readiness.commitsNothing).toBe(false);
    expect(readiness.blocker?.reason).toBe("conflicts_not_loaded");
  });

  it("accepts whole ImportRows, not just the fields it reads", () => {
    const row: ImportRow = {
      index: 7,
      raw: { "Item Name": "Bottled Water 500ml", SKU: "BW-500" },
      parsed: { name: "Bottled Water 500ml", barcode: "BW-500" },
      status: "conflict",
      errors: {},
      notes: [],
      conflict: {
        existingProductId: "652f1a2b3c4d5e6f70819234",
        existingName: "Bottled Water 500ml",
        resolution: "update",
      },
    };

    expect(
      commitReadiness({
        job: { status: "reviewing", counts: counts({ conflict: 1 }) },
        rows: [row],
      }).canCommit,
    ).toBe(true);
  });
});

describe("spreadsheetRowNumber", () => {
  // Trap 6: `index` is 0-based over DATA rows and row 1 of the file is the
  // header, so the server's own "Duplicated in the file (rows 3, 4)" means the
  // spreadsheet's rows 5 and 6.
  it("offsets a 0-based data index past the header row", () => {
    expect(spreadsheetRowNumber(0)).toBe(2);
    expect(spreadsheetRowNumber(3)).toBe(5);
  });
});

describe("countsFromNotReadyError", () => {
  const notReady = (details?: Record<string, unknown>) =>
    new ApiError({
      message: "This import still has rows that need attention",
      status: 422,
      code: API_ERROR_CODE.IMPORT_NOT_READY,
      details,
    });

  it("reads the fresh counts the refusal carries", () => {
    expect(
      countsFromNotReadyError(
        notReady({
          counts: { ready: 1, needsAttention: 1, conflict: 0, skipped: 0 },
        }),
      ),
    ).toEqual({ ready: 1, needsAttention: 1, conflict: 0, skipped: 0 });
  });

  it("returns undefined for another code, a missing details, or a wrong shape", () => {
    expect(countsFromNotReadyError(notReady())).toBeUndefined();
    expect(
      countsFromNotReadyError(notReady({ counts: { ready: 1 } })),
    ).toBeUndefined();
    expect(countsFromNotReadyError(new Error("boom"))).toBeUndefined();
    expect(
      countsFromNotReadyError(
        new ApiError({
          message: "nope",
          status: 409,
          code: API_ERROR_CODE.IMPORT_NOT_REVIEWING,
          details: {
            counts: { ready: 1, needsAttention: 0, conflict: 0, skipped: 0 },
          },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("rowIndexFromConflictChangedError", () => {
  it("names the row that lost the barcode race", () => {
    expect(
      rowIndexFromConflictChangedError(
        new ApiError({
          message: "A product with this barcode was created by someone else",
          status: 409,
          code: API_ERROR_CODE.IMPORT_CONFLICT_CHANGED,
          details: { rowIndex: 0 },
        }),
      ),
    ).toBe(0);
  });

  it("returns undefined when the code or the detail is not there", () => {
    expect(rowIndexFromConflictChangedError(undefined)).toBeUndefined();
    expect(
      rowIndexFromConflictChangedError(
        new ApiError({
          message: "gone",
          status: 404,
          code: API_ERROR_CODE.IMPORT_ROW_NOT_FOUND,
          details: { rowIndex: 3 },
        }),
      ),
    ).toBeUndefined();
  });
});
