# Slice 5 — reports (`2i`)

Six screens on twelve endpoints: a hub plus Sales, Products, Debts, Customers and Staff.
`docs/contracts/reports.md` is the source-derived contract and holds the field-by-field detail.
This file is the part the contract cannot say — the traps that survive a careful reading of the
JSON, the calls made against the design, and what is left for the owner.

## 1. Four ways to read these payloads wrongly

Each of these produces a screen that renders, looks right, and states something false. All four
are load-bearing enough to have a test.

### 1.1 `marginPct` is a fraction, and the name says otherwise

`marginPct` is `round4(grossProfit / revenue)` (`sales.report.ts:97,106`). The fixture's `0.3769`
is **37.69%**. Printing it with a `%` sign appended reads as a margin of one third of one percent
— a plausible-looking figure on a screen full of plausible-looking figures. Same trap on `share`,
which is also 0..1 (§2.1).

### 1.2 `payment-mix.byCurrency` — the key is the tender, the value is not

`key` is the currency the customer physically handed over; `value` is `amountPaidMain`, still in
the business's **main** currency (§3.3, §6). A row rendered as `KES 113.00` claims 113 shillings
where the number means 113 dollars' worth of sales that were tendered in shillings. The screen
says `Tendered in KES … USD 113.00`, and `sales-report.test.tsx` asserts `KES 113.00` appears
nowhere on the page.

### 1.3 `byPaymentStatus` is not zero-filled

A period with no credit sales has **no `credit` row** — the array is built from what the `$group`
found. Rendered straight through, the legend grows and shrinks between periods, and "no credit
sales this week" is indistinguishable from a half-loaded panel. `zeroFilledStatuses` adds the
missing statuses back as zeros, which is what they are rather than invented data.

### 1.4 `share` is a share of the rows shown, not of the period

`toBreakdown` computes `share` **after `$limit`** (`shapes.ts:55-62`). On a top-10, the leader's
`0.8889` is 88.9% *of those ten*, not of revenue — the same fixture's top-2 customers sum to 90
against a period revenue of 199. Every panel using `BreakdownRows` passes that sentence to its
`info` slot, and the bar is drawn from `share` rather than `value / max` (scaling to the largest
row would paint the first bar full width on every report, which says nothing).

## 2. The period contract, and the three 400s that were unmapped

`from`/`to` pass `validate` as soon as they match `/^\d{4}-\d{2}-\d{2}$/`. It is `resolvePeriod`,
inside the service, that then rejects the pair — as a **400 with a domain code**, not the 422 with
`fieldErrors` that every other invalid input produces:

| Code | Raised when | Source |
|---|---|---|
| `INVALID_PERIOD` | `from` after `to`, or only one of the pair sent | `Backend/src/lib/period.ts:79,84` |
| `PERIOD_TOO_LONG` | more than 366 inclusive days apart | `period.ts:86-88` |
| `INVALID_DATE` | date-shaped but not on the calendar (`2026-02-31`) | `period.ts:51,58` |

A client that branches on `status === 422` never sees them. They were **missing from
`API_ERROR_CODE` entirely** until this slice; the sales slice had found them, written a local copy
in `sale-filters.tsx`, and left a note saying they belonged to "whoever builds the shared period
picker". That is this slice, so:

- the three are now real members of `API_ERROR_CODE`;
- the guard, the 366-day cap and the epoch-day arithmetic moved to **`lib/period.ts`**, shared by
  the six report screens and the sales list;
- `sale-filters.tsx` re-exports them unchanged, so its twelve existing tests still exercise the
  moved code through the re-export and nothing had to be re-proved.

**`to` is an inclusive calendar date on the way in and an exclusive instant on the way out.**
`resolvePeriod` advances `to` by a day before the `$lt`, and the `period` echo is ISO instants —
`?to=2026-09-03` in `Africa/Nairobi` echoes `2026-09-03T21:00:00.000Z`, which is local midnight on
the **4th**. Feeding `period.to` back into a `to=` query is wrong twice over: wrong format (a 400
`INVALID_DATE`) and, if truncated to a date, off by one day. The period bar subtracts the day back
before it displays a range.

**There is no "All time".** Every period-taking report falls through to `period ?? "month"`
server-side (§1.5), so omitting the dates does not mean everything — it means this month. An
option labelled All time would quietly report thirty days.

## 3. `GET /reports/dashboard` is not `GET /dashboard`

Two features sharing a word, and the identical success message `"Dashboard fetched"`. The hub uses
**`/reports/dashboard`**: it is the only one that honours the period picker, and it is gated on the
same `reports:view` as the other eleven, so it cannot 403 a reader who can already see the tabs.
`GET /dashboard` is the home screen — a fixed today/this-month/last-7-days registry on
`organization:view`.

### `debts/summary` echoes a period that half its fields ignore

Four of its eight numbers are **point-in-time** (`outstanding`, `openCount`, `overdueAmount`,
`overdueCount` — computed against *now*, regardless of the period) and four move with the picker,
each keying off a different date field (`Debt.createdAt`, `Payment.createdAt`, `Debt.writtenOffAt`).
Filing all eight under one "This month" heading is a lie about four of them, so the debts report
splits them into two labelled groups.

### `products/stock`: low and out cannot be added together

A product with a threshold set and a quantity of zero appears in **both** lists. The panel says so
rather than showing a sum.

## 4. Calls made against the design

- **`stockQuerySchema` takes no params at all** — not even a period. The stock report is a
  point-in-time read, so the period bar is hidden on it rather than being drawn and ignored.
- **The tabs are links, not ARIA tabs.** The design draws a tab strip; these are six routes with
  their own URLs, and announcing them as tabs would promise a panel that swaps in place.
  `aria-current="page"` marks the active one.
- **No tab is permission-hidden**, unlike `TeamTabs` — all six pages run on `reports:view`, so a
  reader who can see one can see all six. Hiding tabs here would imply a distinction that does not
  exist.
- **The "Export · coming soon" chip and the reserved "Highlights" card were not built.** There is
  no export endpoint anywhere in the contract, and no endpoint produces prose; writing the
  Highlights sentence client-side would mean inventing a comparison against a period the API was
  never asked for. A control that does nothing is worse than no control — the same call the
  Overview made about its `…` menu.
- **The timezone sits on the period bar, not in a footnote.** Every report resolves its window in
  the *business's* timezone, so an owner in London reading a Nairobi shop needs to see whose
  "today" this is at the moment they pick it.
- **Currency comes from `useOrganization`.** No report payload carries a currency field — not one
  of the twelve — and the two available sources name the same three values differently
  (`mainCurrency`/`exchangeCurrency`/`exchangeRate` vs `main`/`exchange`/`rate`, the latter
  nullable). One source, normalised once.

## 5. For the owner

- **No export.** The design's Export chip has no endpoint behind it. If shopkeepers need reports on
  paper or in a spreadsheet, that is a backend feature, not a frontend one.
- **No period-over-period comparison.** Nothing in the API returns a previous-period figure, so
  "up 12% on last month" cannot be shown without a second request per figure and a client-side
  subtraction. Worth deciding before the Highlights card is designed around it.
- **366 days is the hard ceiling.** A year-on-year view is impossible through these endpoints.

## 6. Verification

`bunx tsc --noEmit`, `bunx biome check .` and the full suite clean at **993 tests / 108 files**.
Both `sales-report` guards were break-tested: removing the zero-fill reddens exactly the zero-fill
test, and formatting `byCurrency.value` with `row.key` reddens exactly the tendered-currency test.

Two of those tests were themselves wrong when first written — they asserted `USD 0.00` and
`USD 113.00` at the document level, where the figures above the breakdown legitimately print the
same strings (`discountTotal` is 0, `collectedAtSale` is 113). They failed against a component that
was correct. Both are now scoped to the breakdown row. **An ambiguous `getByText` on a page of
money is a coin flip**, and on this screen most of the figures are formatted identically.
