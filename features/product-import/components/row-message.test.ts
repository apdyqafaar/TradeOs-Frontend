import { describe, expect, it } from "vitest";
import type { ImportColumnMap, ImportRow } from "../types";
import {
  importFieldLabel,
  rowMessages,
  translateRowError,
} from "./row-message";

/**
 * The five `errors` strings in this file are **not invented**. They are what
 * the API returned when the owner's 25-row fixture was uploaded to a running
 * backend on 2026-09-10, transcribed from
 * `docs/findings/slice4-import-live-observations.md` §1. Testing the
 * translation against anything else would prove nothing: the whole point is
 * that these particular strings must never reach a shopkeeper.
 */
const LIVE = {
  nameMissing: "Invalid input: expected string, received undefined",
  sellingPriceMissing: "Invalid input: expected number, received undefined",
  negativeQuantity: "Invalid input",
  nameTooLong: "Too big: expected string to have <=120 characters",
  duplicateBarcode: "Duplicated in the file (rows 6, 7)",
} as const;

const columnMap = (over: Partial<ImportColumnMap> = {}): ImportColumnMap => ({
  name: "Item Name",
  barcode: "SKU",
  category: "Category",
  unit: "Unit",
  costPrice: "Cost",
  sellingPrice: "Sales Price",
  quantity: "Qty",
  lowStockThreshold: null,
  trackStock: null,
  description: null,
  ...over,
});

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  index: 1,
  raw: {},
  parsed: {},
  status: "needs_attention",
  errors: {},
  notes: [],
  ...over,
});

describe("translateRowError — the five messages observed live", () => {
  it("turns a blank name cell into a sentence about the name, not about a type", () => {
    // Live row 2. `cleanRow` only sets `parsed.name` when the cell has
    // something in it (`../Backend/src/services/import/clean.ts:120-121`), so
    // an absent value IS the blank cell — read off data, never off the message.
    expect(
      translateRowError({
        field: "name",
        message: LIVE.nameMissing,
        parsed: {},
      }),
    ).toBe("Name is missing");
  });

  it("says the selling price is missing rather than 'received undefined'", () => {
    // Live row 3. "expected number, received undefined" reads like a system
    // fault; it is an empty cell in the reader's own spreadsheet.
    expect(
      translateRowError({
        field: "sellingPrice",
        message: LIVE.sellingPriceMissing,
        parsed: { name: "Sugar 1 kg", costPrice: 1.2 },
      }),
    ).toBe("Selling price is missing");
  });

  it("names the actual problem behind a bare 'Invalid input' quantity", () => {
    // Live row 5, whose quantity cell is `-3`. The message carries no
    // information at all; the value does.
    expect(
      translateRowError({
        field: "quantity",
        message: LIVE.negativeQuantity,
        parsed: { quantity: -3 },
      }),
    ).toBe("Quantity cannot be negative");
  });

  it("translates the 120-character name limit into the limit, not the assertion", () => {
    // Live row 14, a 140-character name.
    expect(
      translateRowError({
        field: "name",
        message: LIVE.nameTooLong,
        parsed: { name: "x".repeat(140) },
      }),
    ).toBe("This name is too long — 120 characters is the limit");
  });

  it("does not repeat the server's duplicate row numbers, which are 0-based", () => {
    // Live rows 6 and 7. This message is the one that reads well — but its
    // numbers are 0-based data indexes, so "rows 6, 7" means the spreadsheet's
    // rows 8 and 9 (contract Trap 6). Echoing it into the Message column would
    // send the reviewer to the wrong two lines.
    const text = translateRowError({
      field: "barcode",
      message: LIVE.duplicateBarcode,
      parsed: { barcode: "5449000000996" },
    });

    expect(text).toBe("This barcode is on more than one row of this file");
    expect(text).not.toMatch(/\d/);
  });
});

describe("translateRowError — it never reads the message", () => {
  it("gives the same answer whatever the API's prose says", () => {
    // The messages are zod's and change with a zod upgrade
    // (`features/product-import/types.ts` says so on `ImportRow.errors`). A
    // translation that quietly depended on them would pass today and mislead
    // after an upgrade, with no test failing.
    const parsed = { name: "y".repeat(200) };

    expect(
      translateRowError({ field: "name", message: LIVE.nameTooLong, parsed }),
    ).toBe(
      translateRowError({
        field: "name",
        message: "something else entirely",
        parsed,
      }),
    );
  });

  it("tells an unreadable cell apart from an empty one", () => {
    // Both arrive as `parsed.sellingPrice === undefined` with the identical
    // zod message, because `cleanNumber` returns null for a cell nothing
    // numeric survives (`clean.ts:74-86`). Only the raw cell separates them.
    expect(
      translateRowError({
        field: "sellingPrice",
        message: LIVE.sellingPriceMissing,
        parsed: {},
        cell: "N/A",
      }),
    ).toBe("We could not read a selling price from “N/A”");

    expect(
      translateRowError({
        field: "sellingPrice",
        message: LIVE.sellingPriceMissing,
        parsed: {},
        cell: "   ",
      }),
    ).toBe("Selling price is missing");
  });
});

describe("translateRowError — the other bounds", () => {
  it("distinguishes the three barcode rules from a file-level duplicate", () => {
    const at = (barcode: string) =>
      translateRowError({ field: "barcode", message: "", parsed: { barcode } });

    expect(at("ABC")).toBe(
      "This barcode is too short — 4 characters is the minimum",
    );
    expect(at("x".repeat(65))).toBe(
      "This barcode is too long — 64 characters is the limit",
    );
    expect(at("has space")).toBe(
      "A barcode can only use letters, numbers, dots, dashes and underscores",
    );
  });

  it("keeps money and quantity refusals in the reviewer's terms", () => {
    expect(
      translateRowError({
        field: "costPrice",
        message: "",
        parsed: { costPrice: -1 },
      }),
    ).toBe("Cost price cannot be negative");

    expect(
      translateRowError({
        field: "costPrice",
        message: "",
        parsed: { costPrice: 12.345 },
      }),
    ).toBe("Cost price can have at most 2 decimals");

    expect(
      translateRowError({
        field: "quantity",
        message: "",
        parsed: { quantity: 1.2345 },
      }),
    ).toBe("Quantity can have at most 3 decimals");
  });

  it("does not accuse a value the server would accept", () => {
    // `8.29` fails a naive `value % 0.01 === 0` test in binary floats, which
    // would make this file report a decimals problem on a price the API takes.
    // The mirrored check is the scaled one from `../Backend/src/lib/money.ts`.
    expect(
      translateRowError({
        field: "costPrice",
        message: "",
        parsed: { costPrice: 8.29 },
      }),
    ).toBe("Cost price cannot be used");
  });

  it("reads an unknown category as a permission problem, not a typo", () => {
    // `errors.category` is only ever set to "Unknown category", and only after
    // a refused commit by a caller without `categories:create`
    // (`product-import.service.ts:45,530-531`). Before that, an unknown
    // category is a NOTE on a `ready` row.
    expect(
      translateRowError({
        field: "category",
        message: "Unknown category",
        parsed: { category: "Grains" },
      }),
    ).toBe(
      "This category does not exist yet, and you cannot create new categories",
    );
  });

  it("has a sentence for an object-level refusal, which has no field", () => {
    // `zodToFieldErrors` keys an empty zod path as the literal "_"
    // (`error.middleware.ts:9-16`), so this key is real and nameless.
    expect(translateRowError({ field: "_", message: "", parsed: {} })).toBe(
      "We could not read this row",
    );
  });
});

describe("rowMessages", () => {
  it("keeps the raw message reachable without ever showing it first", () => {
    const [message] = rowMessages(
      row({ errors: { name: LIVE.nameMissing } }),
      columnMap(),
    );

    expect(message.text).toBe("Name is missing");
    expect(message.raw).toBe(LIVE.nameMissing);
    expect(message.tone).toBe("problem");
    expect(message.field).toBe("name");
  });

  it("uses the column map to find the reviewer's own cell", () => {
    // `columnMap` is field → header, which is the inverse of how the design
    // draws step 2 (observation §0). Getting the direction wrong here would
    // silently produce the vaguer sentence instead of failing.
    const [message] = rowMessages(
      row({
        raw: { "Sales Price": "n/a" },
        errors: { sellingPrice: LIVE.sellingPriceMissing },
      }),
      columnMap(),
    );

    expect(message.text).toBe("We could not read a selling price from “n/a”");
  });

  it("passes notes through verbatim and never as problems", () => {
    // Observation §3: notes already read well, and a `ready` row can carry one.
    const note =
      'Category "Grains" does not exist yet — it will be created on commit';
    const messages = rowMessages(row({ status: "ready", notes: [note] }));

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe(note);
    expect(messages[0].tone).toBe("note");
    expect(messages[0].raw).toBeUndefined();
  });

  it("puts errors before notes, and the most fixable field first", () => {
    const messages = rowMessages(
      row({
        parsed: { quantity: -3 },
        errors: {
          quantity: LIVE.negativeQuantity,
          name: LIVE.nameMissing,
        },
        notes: ["Assumed not stock-tracked — looks like a service item"],
      }),
    );

    expect(messages.map((m) => m.text)).toEqual([
      "Name is missing",
      "Quantity cannot be negative",
      "Assumed not stock-tracked — looks like a service item",
    ]);
  });

  it("is empty for a clean ready row", () => {
    expect(rowMessages(row({ status: "ready" }))).toEqual([]);
  });
});

describe("importFieldLabel", () => {
  it("labels the fields a reviewer sees, and falls back to the key", () => {
    expect(importFieldLabel("sellingPrice")).toBe("Selling price");
    expect(importFieldLabel("lowStockThreshold")).toBe("Low-stock level");
    // Not a `ProductImportField`, but `importRowSchema` still validates it
    // (`clean.ts:19`), so it can key an `errors` entry.
    expect(importFieldLabel("categoryId")).toBe("Category");
    expect(importFieldLabel("whatIsThis")).toBe("whatIsThis");
  });
});
