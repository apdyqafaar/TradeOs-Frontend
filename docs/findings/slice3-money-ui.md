# Slice 3 — shared money UI (currency toggle, money input, customer picker)

Three primitives built once for two screens that do not exist yet: the counter (`/sales/new`,
artboard `2a`) and the record-payment dialog (`/debts/[id]`, artboard `2g`). Everything below is
something the canvas, the tokens or the existing hooks did not answer, and that the next person
would otherwise decide again.

## Artboard `2a` contradicts itself about which currency is the main one

**What:** `2a` draws its totals in USD, puts `USD` first and selected in the toggle, and then
prints the hint `1 USD = 130 KES`. Those cannot all be true. The hint is only honest when
`exchangeRate` is read as units of MAIN per one unit of EXCHANGE — which it is — and that makes
main KES and exchange USD, contradicting both the USD totals and the USD-first ordering.

**Evidence:** `docs/design/TradeOs-UI.dc.html:313` (`USD 267.75` total), `:321-322` (`USD`
selected, `KES` second), `:324` (`1 USD = 130 KES`). `CurrencyContext.exchangeRate` in
`features/organization/hooks/use-currency-config.ts:30-35` and `toMain` in
`Backend/src/lib/money.ts` are the authority for the direction. `2g` repeats the identical block
at `:940-943`, so the inconsistency is duplicated, not a one-off.

**So what:** the canvas is a plausible-looking mock, not a worked example, and the two halves were
split rather than reconciled. `CurrencyToggle` orders the segments `[main, exchange]` (so the first
one matches every total on the screen) and builds the hint as
`` `1 ${exchange} = ${rate} ${main}` ``. Do not "fix" the ordering to match the canvas's hint, and
do not copy the hint's phrasing onto a different pair — this is the exact inversion that once
printed KES 0.77 for a KES 13,000 tender.

## `2a` and `2g` draw the same three controls in different tones

**What:** the two artboards disagree on the segmented-control track, on the amount field's
background and on the label size. Nothing marks either as canonical.

**Evidence:**

| | `2a` | `2g` |
|---|---|---|
| toggle track | `#E8E6DE` (`:320`) | `#F0EEE6` (`:939`) |
| amount field fill | `#FBFAF7` (`:329`) on a `#F5F4EE` panel (`:317`) | `#F5F4EE` (`:950`) inside a `#FBFAF7` popup (`:936`) |
| field label | 12px (`:328`) | 13px (`:947`) |

**So what:** the field is not a fixed colour, it is *one step off whatever it sits on* — which a
shared primitive cannot express, because it does not know its own surroundings. The tie-breaks
taken: the track is `--surface-2`, because `app/globals.css:176-182` documents that token in words
as "the segmented-control track" and a comment beats a pixel; the field is `bg-background`,
matching `CONTROL` in `features/products/components/stock-dialog.tsx:64-65` and the inputs in
`customer-form-sheet.tsx`; the label is `text-[13px]`, matching the shared `Field` in
`customer-form-sheet.tsx:473`. A caller that places `MoneyInput` on `--background` will see a field
that does not separate from its panel — pass a `className` overriding the fill rather than changing
the default.

## `lib/format/money.ts` has no exported rate formatter, and `formatMoney` cannot stand in

**What:** the rate hint needs a number with up to six decimals and no padding. `formatMoney` is
fixed at two, so the other direction of the same pair (main USD, exchange KES, rate 0.0077) renders
as `USD 0.01`.

**Evidence:** `lib/format/money.ts:28-32` defines exactly the right formatter, named `RATE`, and
does not export it; `:16-19` fixes `MONEY` at two decimals. `components/shared/currency-toggle.test.tsx`
locks `1 KES = 0.0077 USD` for that configuration.

**So what:** `currency-toggle.tsx` carries a six-decimal `Intl.NumberFormat` of its own with a
comment pointing at the original. That is a deliberate duplicate of four lines, taken instead of
editing a file outside this task's brief. If a third caller ever needs it, export `RATE` from
`lib/format/money.ts` and delete the copy — do not reach for `formatMoney`.

## The canvas puts no currency code inside the amount box

**What:** both artboards draw the field holding a bare number (`100.00`, `60.00`). The only thing
naming the currency is the toggle sitting above it, which is a separate control — and which
`CurrencyToggle` renders as *nothing at all* for a single-currency business.

**Evidence:** `docs/design/TradeOs-UI.dc.html:329` and `:950`. The code appears only in the max
hint, `max USD 167.75` (`:951`).

**So what:** a screen-reader user focused on the field would otherwise be told only "Amount".
`MoneyInput` renders a permanently present `sr-only` "Amount in USD" and wires it into
`aria-describedby` alongside the max hint and the converted line. It costs no layout — `sr-only` is
absolutely positioned, so it is not a flex item and contributes no `gap` — which is the only reason
it could be unconditional. The visible design is unchanged; do not "simplify" this away.

## `type="number"` destroys a half-typed decimal, so the field holds text

**What:** a number input reports `""` for anything the browser considers invalid, and `"12."` is
invalid. Bound to a controlled numeric value, the amount therefore disappears for the keystroke
between `12` and `12.5`.

**Evidence:** `components/shared/money-input.test.tsx` — "does not destroy a half-typed number"
asserts the box still reads `"12."` while the caller holds `12`.

**So what:** `MoneyInput` is `type="text"` with `inputMode="decimal"`, and every value passes one
regex (`^\d*(\.\d{0,2})?$`). A keystroke that fails it is **dropped**, not corrected: rewriting the
string would move the caret, and clamping `"12."` to `"12"` would delete the point on the frame it
was typed. Two decimals are applied on blur only. `stock-dialog.tsx:291-297` reached the same
conclusion for a different reason (a signed delta needs a minus sign on a phone keypad) — between
them, treat `type="number"` as unusable in this product.

## Keeping a text box in step with a numeric prop needs render-time adjustment, not an effect

**What:** the caller owns a `number | null` and the box owns a string; they have to resync when the
caller changes the value from outside (a "Pay in full", a reset after a sale) but *not* while
somebody is typing. An effect does it one render late and re-renders the field twice per keystroke.

**Evidence:** `money-input.tsx` compares `parseAmount(draft) !== value` during render and calls
`setDraft`/`setLastValue` there. Comparing the *parsed number* rather than the string is what lets
`"12."` survive: it parses to `12`, which is what the caller holds, so no resync fires.

**So what:** this is React's documented "adjusting state when a prop changes", and with the React
Compiler on it needs no memo hooks. It also gives a useful behaviour for free: a caller that
overrides what was typed (clamping to `max`) sets a value the draft does not parse to, and the box
adopts it. `MoneyInput` deliberately does **not** clamp to `max` itself — it reports 200 against a
max of 167.75 and flags it — because silently clamping tells a shopkeeper their 200 was taken.

## A refusal signalled only by colour reaches nobody who cannot see it

**What:** the canvas has no over-max state at all; the only styling available for one is the
destructive token pair.

**Evidence:** `2g` draws `max USD 167.75` in `#8A8880` (`:951`) and nothing else.

**So what:** `MoneyInput` changes the *words* as well as the tone — `max USD 167.75` becomes
`over the max of USD 167.75` — and sets `aria-invalid`. Because the hint is in `aria-describedby`,
the change is announced. This is an addition to the design, not a reading of it.

## "Pay in full" and "Change" are drawn as text, and had to become buttons

**What:** the canvas renders both affordances as bare terracotta spans, with no button chrome.

**Evidence:** `:948` (`Pay in full`, 12px/500/`#D97757`) and `:346` (`Change`, same treatment).

**So what:** both change state, so both are real `<button type="button">` with a focus ring, styled
to look exactly as drawn. `Change` additionally carries an `sr-only` suffix naming the field, so two
pickers on one screen do not both announce as "Change". The visible text is a prefix of the
accessible name, which keeps WCAG 2.5.3 satisfied for voice control.

## Native radios beat `aria-pressed` buttons for the toggle, at the cost of a `has-[]` focus ring

**What:** a two-option segmented control can be built as a radio group or as two toggle buttons.
The radio group brings a full keyboard contract for free — one tab stop for the group, arrow keys
between options, a name each — which a roving-tabindex implementation has to reproduce by hand.

**Evidence:** `currency-toggle.tsx` uses `<fieldset>` + `sr-only` `<input type="radio">` inside
`<label>`; `components/shared/currency-toggle.test.tsx` asserts one tab stop and Space-to-select.

**So what:** the trade-off is that the focusable element is invisible, so the focus ring has to be
drawn on the label via `has-[:focus-visible]:` rather than on the input. That works, but it means
the ring cannot use the repo's usual `focus-visible:border-ring` pairing. Note also that the repo's
hand-rolled tabs (`products-page.tsx:137-149`, `customer-detail.tsx:323-335`) use `role="tab"`;
that is the wrong role here — these options control no panel.

## The picker had to be split in two so `useCustomers` is only mounted while searching

**What:** `CustomerPicker` returns `null` without `customers:view`, and shows a static summary once
a customer is chosen. Neither state should hold an open query — but an early `return` placed before
`useCustomers` changes the hook count as the session resolves from "no permissions" to "permitted",
which React rejects outright.

**Evidence:** `useCustomers` (`features/customers/hooks/use-customers.ts:30`) takes only
`CustomerListParams` — there is no `enabled` escape hatch to disable it in place, and adding one
would change a hook two other screens already use.

**So what:** `customer-picker.tsx` is two components: the exported one does the permission check and
the chosen/searching branch, and a private `CustomerSearch` owns the query. Mounting it fresh also
resets the search box for free, which is the wanted behaviour after "Change". Any future control
with a permission gate in front of a query wants this shape.

## The picker's opening state is dictated by a 422, not by the design

**What:** the canvas draws only the *chosen* state of the customer field. What an empty picker shows
before anybody types was undefined — and the obvious answer, "send an empty search", is a 422.

**Evidence:** `listCustomersQuerySchema` is `.strict()` with `search` at `min(1)`, so `?search=` is
refused (`features/customers/components/customers-page.tsx:76-87` records the same trap for the
list screen, where it would fire on the page's normal unfiltered state).

**So what:** the picker drops the `search` key entirely when the box is empty, which lists the first
8 active customers — so the opening state is a short "who do I sell to" list rather than a blank
panel. `status: "active"` is passed explicitly rather than relying on the backend default, because
an archived customer must not be attachable to a new sale or a payment.

## The empty-results copy cannot quote what was typed

**What:** the backend matches a `^term` **prefix** against the lower-cased name or the *normalised*
phone, so "wholesale" finds nothing for "Bakaara Wholesale" and a phone typed with spaces finds
nothing at all. The recovery is fewer characters, not a different spelling — the message has to say
so. It cannot, however, quote the term.

**Evidence:** `Backend/src/db/actions/customer.actions.ts:38-42`, transcribed in
`features/customers/types.ts:113-121`. The search is debounced 300ms, so the box (`draft`) and the
term the results belong to (`search`) differ for that window — quoting either one shows a message
about a term whose answer is not on screen.

**So what:** the copy is term-free: "No customer matches that. Search matches the start of a name or
a phone number, so try fewer characters." Anyone tempted to add `“{term}”` has to reconcile the two
values first.

## Building ARIA's combobox pattern past biome's recommended a11y rules

**What:** the result list is a listbox whose selection moves through `aria-activedescendant` while
focus never leaves the text box. Written the obvious way — `<ul role="listbox">` with
`<li role="option">` — biome's recommended set raises **five** errors: `useSemanticElements`,
`noNoninteractiveElementToInteractiveRole` (twice, once per element), `useFocusableInteractive` and
`useKeyWithClickEvents`. Four of the five are avoidable; only the last needs a suppression.

**Evidence:** the shape `customer-picker.tsx` ended up with, and what each change bought:

- **`<div>` instead of `<ul>`/`<li>`.** `div` is role-neutral, so
  `noNoninteractiveElementToInteractiveRole` does not fire, and — empirically —
  `useSemanticElements` does not fire for `listbox`/`option` on a `div` either, though it *does*
  fire for `role="status"` on one.
- **`<output>` instead of `<div role="status">`** for the loading region: `output` carries that
  role implicitly, which is what the rule was asking for.
- **`tabIndex={-1}` on each option** satisfies `useFocusableInteractive` and is what the pattern
  wants anyway — focusable by script, never by tab.
- **No `role="group"` on the chosen-customer row.** It tripped `useSemanticElements` (which wants a
  `<fieldset>`) for an announcement that adds nothing: the caption is the element immediately
  before it, which is how every other labelled value in this repo reads.
- One suppression survives: `lint/a11y/useKeyWithClickEvents` on the option.

**So what:** two things to carry forward. First, **a biome suppression only applies to the line
immediately below it** — a `// biome-ignore …:` line followed by three more `//` lines of
explanation suppresses the *comment*, and biome then reports both `suppressions/unused` and the
original error, which reads as if the rule were unsuppressable. Put the explanation above and the
`biome-ignore` last. Second, do not "fix" the remaining suppression by giving options their own key
handlers or turning them into buttons; keys belong on the input and an option that took focus would
pull the caret out of the search box.

Unrelated to the lint, and worth knowing: the list renders inline rather than in a popover, which is
what lets it skip outside-click handling, a focus trap and a portal. `aria-expanded` is hard-coded
`"true"` for the same reason — the list never collapses, and claiming otherwise would describe a
control that is not there.

## `CurrencyToggle` renders nothing while the config is still loading

**What:** `hasExchange` is false during loading as well as for a single-currency business, so the
toggle is absent on first paint and may appear a beat later. There is no skeleton state.

**Evidence:** `features/organization/hooks/use-currency-config.ts:86-93` — `hasExchange` requires
`!isLoading`.

**So what:** this is the right call (a `USD | USD` flash is worse than an appearing control), but it
means **a caller must not lay out around the toggle assuming it is present**, and must seed its
`value` with `mainCurrency` once known. A `value` matching neither option leaves both radios
unchecked — the component will not guess, because guessing is how the wrong currency gets recorded.

## `CustomerPicker` renders nothing without permission, and says nothing about it

**What:** a role without `customers:view` gets an empty element where the field would be. That is
the repo's rule, but it leaves a form that cannot be completed with no explanation in it.

**Evidence:** the rule is `CLAUDE.md`'s and is applied the same way in
`features/categories/components/category-tab.tsx:166-180` (no disabled delete for a protected
category, no control at all). `PRESET_SELLER` does hold `customers:view`
(`lib/auth/permissions.ts:113-128`), so this only bites a custom role.

**So what:** the counter must gate its whole credit path on `customers:view` with its own `useCan`,
not rely on the picker to explain itself — a credit sale requires a customer, and a seller who
cannot look one up needs to be told that before they have built a cart. The record-payment dialog is
unaffected: it does not pick a customer.

## Smaller notes

- The canvas's focus glow is `box-shadow:0 0 0 2px rgba(217,119,87,0.24)`
  (`docs/design/TradeOs-UI.dc.html:235`); every control in this repo uses `ring-3 ring-ring/50`
  instead. These primitives follow the repo, not the canvas — one product should have one focus ring.
- `formatExchange` returns `{ tendered, converted }` and `MoneyInput` renders only `converted`: the
  box itself *is* the tendered amount. `converted` is `null` for an unusable rate, which is the
  guard against printing `Infinity` under an amount field.
- The 8px inner radius of the toggle pill is exactly `--radius-md` (`calc(0.625rem * 0.8)`), so
  `rounded-md` would have worked; `rounded-[8px]` was used to read the same as the surrounding
  `rounded-[10px]` / `rounded-[9px]` literals.
- `--muted-2` (`#8A8880`) covered every "third-level grey" the two artboards use for the rate hint
  and the max hint. Nothing in these three components needed a colour the tokens could not express.
