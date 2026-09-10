import type {
  ImportColumnMap,
  ImportRow,
  ImportRowParsed,
  ProductImportField,
} from "../types";

/**
 * Turns one staged row into the sentences a shopkeeper can act on.
 *
 * ### Why this file exists
 *
 * `docs/findings/slice4-import-live-observations.md` §1, recorded against a
 * running backend with the owner's 25-row fixture: **the API's row `errors` are
 * raw zod output and are unfit to show a trader.** These are the literal
 * strings that came back —
 *
 * | Real problem | `errors` said |
 * |---|---|
 * | the name cell is blank | `name: "Invalid input: expected string, received undefined"` |
 * | no selling price | `sellingPrice: "Invalid input: expected number, received undefined"` |
 * | quantity is `-3` | `quantity: "Invalid input"` |
 * | the name is 140 characters | `name: "Too big: expected string to have <=120 characters"` |
 * | the same barcode twice in the file | `barcode: "Duplicated in the file (rows 6, 7)"` |
 *
 * Only the last is fit for the review table's **Message** column. "Invalid
 * input" says nothing at all, and "expected number, received undefined" reads
 * like a system fault rather than an empty cell in the reader's own
 * spreadsheet.
 *
 * ### How it decides, and what it refuses to look at
 *
 * **It never reads the message.** `CLAUDE.md`: branch on machine-readable
 * facts, never on prose — and these messages are zod's, so they change with a
 * zod upgrade. What is reliable is the **field key** (the first segment of the
 * failing zod path, `../Backend/src/services/import/clean.ts:190-200`) plus the
 * row's own `parsed` value and, where the column map names a header, the user's
 * raw cell. So `name` with no `parsed.name` is a blank cell; `name` with a
 * 140-character `parsed.name` is a length problem. Both are read off data.
 *
 * The bounds below are copied from the validators the server actually runs —
 * `../Backend/src/validators/product.validation.ts:15-20,42-65`,
 * `clean.ts:14-20` and `../Backend/src/lib/money.ts:12,15` — and are the same
 * bounds `schemas/import.schema.ts` mirrors for the fix dialog. If one changes
 * there, it changes here in the same commit.
 *
 * ### The raw message is kept, never promoted
 *
 * Every translated error carries `raw` — the API's own words — so a support
 * conversation can still see what the server said. Callers put it in a `title`
 * and in the expandable details line. It is never the primary text.
 *
 * ### `notes` are the good half and are not errors
 *
 * Observation §3: `notes` already read well ("Category \"Grains\" does not
 * exist yet — it will be created on commit", "Assumed not stock-tracked —
 * looks like a service item") and a **`ready` row can carry one**
 * (`../Backend/src/db/models/import-job.model.ts:52-60`). They are passed
 * through verbatim with tone `"note"` so nothing styles them as problems.
 */

/* ------------------------------------------------------------------------ */
/* The bounds, mirrored                                                      */
/* ------------------------------------------------------------------------ */

/** `product.validation.ts:42` — trimmed, 1..120. */
const MAX_NAME = 120;
/** `product.validation.ts:15-20` — 4..64, and no spaces. */
const MIN_BARCODE = 4;
const MAX_BARCODE = 64;
const BARCODE_CHARSET = /^[A-Za-z0-9._-]+$/;
/** `clean.ts:17` — the category NAME, max 60. */
const MAX_CATEGORY = 60;
/** `product.validation.ts:60` — 1..20, defaulted to `pcs` by `cleanRow`. */
const MAX_UNIT = 20;
/** `product.validation.ts:53` — max 2000. `cleanRow` truncates before this. */
const MAX_DESCRIPTION = 2000;
/** `../Backend/src/lib/money.ts:12,15`. */
const MAX_MONEY = 1e12;
const MAX_QUANTITY = 1e9;
/** `product.validation.ts:52` — integer, 0..1e9. */
const MAX_LOW_STOCK = 1e9;

/**
 * `|n · 10^d − round(n · 10^d)| < 1e-6`, exactly as `money.ts:34-47` does it.
 * A `%` test rejects honest values — `8.29 % 0.01` is not 0 in binary floats —
 * and would make this file accuse a row the server accepted.
 */
const withinDecimals = (value: number, places: number): boolean => {
  const scale = 10 ** places;
  return Math.abs(value * scale - Math.round(value * scale)) < 1e-6;
};

/* ------------------------------------------------------------------------ */
/* Field labels                                                              */
/* ------------------------------------------------------------------------ */

/**
 * What each field is called in a sentence. Sentence case, because every one of
 * these is used at the head of a line the reviewer reads as prose.
 *
 * `categoryId` is not a `ProductImportField` and is not editable, but
 * `importRowSchema` still validates it (`clean.ts:19`), so it can key an
 * `errors` entry. It is labelled "Category" because that is the only word the
 * reviewer has for it.
 */
const FIELD_LABELS: Record<ProductImportField | "categoryId", string> = {
  name: "Name",
  barcode: "Barcode",
  category: "Category",
  categoryId: "Category",
  unit: "Unit",
  costPrice: "Cost price",
  sellingPrice: "Selling price",
  quantity: "Quantity",
  lowStockThreshold: "Low-stock level",
  trackStock: "Track stock",
  description: "Description",
};

/** The reviewer-facing name of a field, or the raw key when it is unknown. */
export const importFieldLabel = (field: string): string =>
  FIELD_LABELS[field as ProductImportField] ?? field;

/* ------------------------------------------------------------------------ */
/* One error, translated                                                     */
/* ------------------------------------------------------------------------ */

export interface RowErrorContext {
  /** The `errors` key. The reliable half, and the thing this switches on. */
  field: string;
  /**
   * The API's own message. Carried through to `raw` and **never read** — see
   * the file comment.
   */
  message: string;
  /** The row's cleaned values, which is how a blank cell is told from a bad one. */
  parsed: ImportRowParsed;
  /**
   * The reviewer's own cell for this field, when `columnMap` says which header
   * feeds it. Present-but-unreadable ("N/A" in a price column) and genuinely
   * blank are different problems and deserve different sentences.
   */
  cell?: string;
}

/**
 * The plain-language sentence for one `errors` entry.
 *
 * Exported on its own so the mapping can be tested directly against the five
 * strings observed live, which is what
 * `docs/findings/slice4-import-live-observations.md` asks for — those are the
 * actual output of a real run, not invented examples.
 */
export function translateRowError({
  field,
  parsed,
  cell,
}: RowErrorContext): string {
  const label = importFieldLabel(field);
  const filled = cell?.trim() ? cell.trim() : undefined;

  /** "the cell is empty" vs "the cell holds something we could not read". */
  const missing = (thing: string): string =>
    filled
      ? `We could not read ${thing} from “${filled}”`
      : `${label} is missing`;

  switch (field) {
    case "name": {
      if (parsed.name === undefined) return "Name is missing";
      if (parsed.name.length > MAX_NAME)
        return `This name is too long — ${MAX_NAME} characters is the limit`;
      return "This name cannot be used";
    }

    case "barcode": {
      if (parsed.barcode === undefined) return "Barcode is missing";
      if (parsed.barcode.length < MIN_BARCODE)
        return `This barcode is too short — ${MIN_BARCODE} characters is the minimum`;
      if (parsed.barcode.length > MAX_BARCODE)
        return `This barcode is too long — ${MAX_BARCODE} characters is the limit`;
      if (!BARCODE_CHARSET.test(parsed.barcode))
        return "A barcode can only use letters, numbers, dots, dashes and underscores";
      // Every rule `importRowSchema` applies to a barcode is above, so a value
      // that passes all of them and is still flagged has the one remaining
      // documented cause: the same barcode appears on another row of this file
      // (`../Backend/src/services/product-import.service.ts:152-155`).
      //
      // The server's own words name the other rows — but as **0-based data
      // indexes**, so "rows 6, 7" means the spreadsheet's rows 8 and 9 (contract
      // Trap 6). Repeating those numbers here would send the reviewer to the
      // wrong lines, so the sentence says what happened and the raw message
      // stays in the details, where its numbering is explained.
      return "This barcode is on more than one row of this file";
    }

    case "category":
    case "categoryId": {
      if (parsed.category === undefined) return "Category is missing";
      if (parsed.category.length > MAX_CATEGORY)
        return `This category name is too long — ${MAX_CATEGORY} characters is the limit`;
      // The only other documented cause, and it can only arrive after a refused
      // commit: `commitImport` flags rows naming a category that does not exist
      // when the caller lacks `categories:create`
      // (`product-import.service.ts:45,530-531`). An unknown category is
      // otherwise a *note*, not an error, and the row stays `ready`.
      return "This category does not exist yet, and you cannot create new categories";
    }

    case "unit": {
      if (!parsed.unit) return "Unit is missing";
      if (parsed.unit.length > MAX_UNIT)
        return `This unit is too long — ${MAX_UNIT} characters is the limit`;
      return "This unit cannot be used";
    }

    case "costPrice":
    case "sellingPrice": {
      const value = parsed[field];
      const thing = field === "costPrice" ? "a cost price" : "a selling price";
      if (value === undefined) return missing(thing);
      if (value < 0) return `${label} cannot be negative`;
      if (value > MAX_MONEY) return `${label} is too large`;
      if (!withinDecimals(value, 2))
        return `${label} can have at most 2 decimals`;
      return `${label} cannot be used`;
    }

    case "quantity": {
      if (parsed.quantity === undefined) return missing("a quantity");
      if (parsed.quantity < 0) return "Quantity cannot be negative";
      if (parsed.quantity > MAX_QUANTITY) return "Quantity is too large";
      if (!withinDecimals(parsed.quantity, 3))
        return "Quantity can have at most 3 decimals";
      return "This quantity cannot be used";
    }

    case "lowStockThreshold": {
      const value = parsed.lowStockThreshold;
      if (value === undefined) return missing("a low-stock level");
      if (value < 0) return "Low-stock level cannot be negative";
      if (!Number.isInteger(value))
        return "Low-stock level must be a whole number";
      if (value > MAX_LOW_STOCK) return "Low-stock level is too high";
      return "This low-stock level cannot be used";
    }

    case "trackStock": {
      if (parsed.trackStock === undefined)
        return filled
          ? `We could not tell from “${filled}” whether this item is stock-tracked — use yes or no`
          : "Say whether this item is stock-tracked — yes or no";
      return "Track stock must be yes or no";
    }

    case "description": {
      if (parsed.description === undefined) return "Description is missing";
      if (parsed.description.length > MAX_DESCRIPTION)
        return `This description is too long — ${MAX_DESCRIPTION.toLocaleString("en-US")} characters is the limit`;
      return "This description cannot be used";
    }

    // `zodToFieldErrors` keys an issue with an empty path as the literal `"_"`
    // (`../Backend/src/middleware/error.middleware.ts:9-16`), which on a row is
    // an object-level refusal such as an unrecognised key. There is no field to
    // name, so the sentence does not pretend there is one.
    case "_":
      return "We could not read this row";

    default:
      return `This row’s ${label} cannot be used`;
  }
}

/* ------------------------------------------------------------------------ */
/* A whole row, translated                                                   */
/* ------------------------------------------------------------------------ */

/**
 * How a message should read on screen. `note` is deliberately not a shade of
 * `problem`: a `ready` row can carry a note, and styling it as a fault would
 * tell the reviewer to fix a row that is already fine.
 */
export type RowMessageTone = "problem" | "note";

export interface RowMessage {
  /** Stable React key. The field for an error, `note-<n>` for a note. */
  key: string;
  tone: RowMessageTone;
  /** Plain language. This is what the Message column shows. */
  text: string;
  /**
   * The API's own words, for a `title` and the details line. Absent on notes,
   * whose text already *is* the API's words.
   */
  raw?: string;
  /** The `errors` key this came from, so a fix dialog can focus the field. */
  field?: string;
}

/**
 * The order the review table reads them in: whichever field the reviewer is
 * most likely to be able to fix first. `Object.entries` over `errors` would
 * order by whatever key the server happened to write first, which changes with
 * the shape of the file.
 */
const FIELD_ORDER: readonly string[] = [
  "name",
  "sellingPrice",
  "costPrice",
  "barcode",
  "quantity",
  "category",
  "categoryId",
  "unit",
  "lowStockThreshold",
  "trackStock",
  "description",
  "_",
];

const fieldRank = (field: string): number => {
  const rank = FIELD_ORDER.indexOf(field);
  return rank === -1 ? FIELD_ORDER.length : rank;
};

/**
 * Every message one row has to show — its translated errors first, then its
 * notes verbatim.
 *
 * `columnMap` is optional and only sharpens the answer: it is field → header
 * (the inverse of how the design draws step 2, observation §0), so it is what
 * turns `raw` into "the cell the reviewer actually typed" and lets a price of
 * `"N/A"` read as *unreadable* rather than as *missing*. Without it the
 * sentences are still correct, just one shade less specific.
 */
export function rowMessages(
  row: Pick<ImportRow, "raw" | "parsed" | "errors" | "notes">,
  columnMap?: ImportColumnMap,
): RowMessage[] {
  const errors = Object.entries(row.errors)
    .sort(([a], [b]) => fieldRank(a) - fieldRank(b))
    .map(([field, message]): RowMessage => {
      const header = columnMap?.[field as ProductImportField] ?? null;
      return {
        key: field,
        tone: "problem",
        field,
        raw: message,
        text: translateRowError({
          field,
          message,
          parsed: row.parsed,
          cell: header ? row.raw[header] : undefined,
        }),
      };
    });

  const notes = row.notes.map(
    (note, index): RowMessage => ({
      key: `note-${index}`,
      tone: "note",
      text: note,
    }),
  );

  return [...errors, ...notes];
}
