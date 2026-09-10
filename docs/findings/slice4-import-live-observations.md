# Slice 4 — what the import API actually returns, observed live

Recorded 2026-09-10 by uploading `Backend/test-import-products.csv` (the owner's 25-row fixture,
every outcome previously verified against the real parser) to a **running** backend and reading the
responses. `docs/contracts/product-import.md` is the source-derived contract; this file is the
same endpoints seen from outside, and exists because two things only became obvious with real data
in front of them.

## The shapes, as they came back

Job (`POST /products/import`, `GET /products/import/:id`) top-level keys:

```
id, status, filename, format, columnMap, unmatchedHeaders,
totalRows, counts, expiresAt, createdAt, updatedAt, rows, rowsMeta
```

- `counts` is `{ ready, needsAttention, conflict, skipped }` — note **`needsAttention` is camelCase
  here** while the row `status` value is the snake_case `needs_attention`. Both spellings are real
  and they are not interchangeable.
- `rowsMeta` is the familiar `{ page, limit, total, totalPages }`.
- Row keys: `index, raw, parsed, status, errors, notes, conflict`.
- `unmatchedHeaders` came back as `["Vendor"]`, exactly as the fixture predicted.

### `columnMap` is field → header, which is the inverse of how the design draws it

```json
{ "name": "Item Name", "barcode": "SKU", "costPrice": "Cost", … }
```

Artboard `2e` draws step 2 as a list of **file headers**, each with a dropdown selecting the field
it feeds — `header → [field]`. The API is keyed the other way. The screen therefore has to invert
the map to render a row per header, and invert it back to send a `PATCH`. Worth stating plainly
because reading the JSON and building the obvious UI produces a screen keyed by field, which is
not what the design shows and not what someone looking at their own spreadsheet expects.

## 1. The `errors` messages are raw zod output and are unfit to show a shopkeeper

This is the finding that matters most for step 3. The design's **Message** column is the whole
point of the review table, and what the API puts there is developer text:

| Row | Real problem | What `errors` literally says |
|---|---|---|
| 2 | The name cell is blank | `name: "Invalid input: expected string, received undefined"` |
| 3 | No selling price | `sellingPrice: "Invalid input: expected number, received undefined"` |
| 5 | Quantity is `-3` | `quantity: "Invalid input"` |
| 14 | Name is 140 characters | `name: "Too big: expected string to have <=120 characters"` |
| 6, 7 | Same barcode twice in the file | `barcode: "Duplicated in the file (rows 6, 7)"` |

Only the last is fit to display. "Invalid input" tells a trader nothing at all, and
"expected number, received undefined" tells them something actively misleading — it sounds like a
system fault rather than an empty cell in their own spreadsheet.

**So the review table must translate `field + error` into plain language rather than printing the
value.** The field key is reliable and is the thing to switch on; the message is not. Keep the raw
message reachable (a `title`, or a details line) so a support conversation can still see it, but do
not make it the primary text.

## 2. `conflict` carries no price or quantity, and the design shows both

Observed conflict object, both occurrences, two keys only:

```json
{ "existingProductId": "6aa178be2f7394082d889c7b", "existingName": "Coca-Cola 500ml" }
```

Artboard `2e` draws the conflict banner as:

> Row 21 · `6001234567890` already belongs to **Basmati rice 5 kg** (USD 12.40, 3 pcs)

The name is available. **The price and the quantity are not.** Rendering them needs a
`GET /products/:id` per conflicting row, which on a file with fifty conflicts is fifty requests for
a parenthetical. The honest options are to show name only, or to fetch on demand when a reviewer
expands a specific conflict. Do not invent the figures, and do not show the *imported* row's price
where the design shows the *existing* product's — they are different numbers and the whole purpose
of the line is to compare them.

## 3. `notes` are already human-readable, and are the good half

Unlike `errors`, the `notes` array reads well and carries real information the reviewer wants:

- `"Category \"Grains\" does not exist yet — it will be created on commit"`
- `"Assumed not stock-tracked — looks like a service item"`

These are worth surfacing. A note is not a problem — a row can be `ready` and still carry one — so
they must not be styled as errors.

## 4. Conflict count depends on what the business already stocks

The fixture's expectations file predicts `ready 13 / needsAttention 11 / conflict 1`. The live run
returned `ready 12 / needsAttention 11 / conflict 2`, and the extra conflict is correct: row 0's
barcode `5449000000996` matches a Coca-Cola product already seeded in this business, on top of the
`EXIST-001` conflict the fixture sets up deliberately. The expectations file assumes a fresh
organization. Nothing is wrong; it is a reminder that these counts are a function of existing
stock, so a test that hardcodes them is testing the fixture's environment rather than the parser.
