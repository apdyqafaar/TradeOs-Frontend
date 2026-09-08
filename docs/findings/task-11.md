# Task 11 — the Overview page

## A Manager receives both `mySales` and `sales`, and the canvas draws no manager treatment for `mySales`

**What:** `mySales` is gated on `sales:create` and `sales` on `reports:view`, so an Owner or Manager
who works the counter receives both. Artboard `1c` (the manager Overview) contains no My-sales block
at all, and artboard `1e` gives `mySales` the entire page. The canvas therefore answers the Seller
case and is silent on the Manager one.

**Evidence:** `docs/design/TradeOs-UI.dc.html:2050` (`1c`) has no receipts panel; `:2563` (`1e`)
has stat cards plus "My recent receipts". `features/dashboard/types.ts` documents both gates.

**So what:** Resolved in `features/dashboard/components/my-sales-section.tsx` with a `variant` prop
that the page sets from **what else arrived**, never from a role name
(`features/dashboard/components/overview.tsx`, `mySalesVariant`):

- `sales` absent → `primary`: three stat cards plus the receipt list, exactly as `1e` draws it.
- `sales` present → `secondary`: the headline grid belongs to the business, and `mySales` becomes
  one panel beneath the trend — the same two totals as a compact figures row (the shape the Debts
  and Stock panels already use) above the receipts.

A `secondary` block with no receipts is skipped entirely: an empty personal till under a full
business dashboard is noise, whereas for a Seller the empty state *is* the message.

## Three canvas columns have no data behind them

**What:** Panels drawn in the canvas ask for fields the sections do not carry.

| Canvas | Draws | The section actually returns |
|---|---|---|
| `1e` receipts row | number, time, **customer**, status, total | `{ id, number, total, paymentStatus, createdAt }` — no customer |
| `1c` projects row | title, **status pill**, **customer**, bar, %, due | `{ id, title, dueDate, progress }` — no customer, no status |
| `1e` first-steps row | a **ticked** and an unticked state | nothing reports whether a product exists |

**Evidence:** `docs/design/TradeOs-UI.dc.html:2613` (`r.customer` in the receipts row), `:2314`
(`p.customer`, `p.label` in the project row), `:2643` (`s.dotBg` / `s.tick` / `s.labelColor`).
Against `DashboardMySalesRecent`, `DashboardDueSoonProject` and `DashboardStockSection` in
`features/dashboard/types.ts`.

**So what:** The columns are absent rather than blank — a blank cell reads as a loading bug. The
projects row became title / due date / progress, and the receipts row number / time / status /
total. For First steps only the "Invite a teammate" row can ever tick, from
`team.activeCount > 1 || team.invitedCount > 0`; "Add a product" cannot, because `stock` counts only
low and out-of-stock products and both are `0` for a shop with no products **and** for one with full
shelves. If the owner wants that tick, the dashboard needs a product count — one number, and the
`FirstStepsCard` prop for it already exists in the shape of `teamStarted`.

## `thisMonth.count === 0` alone would show "First steps" to a three-year-old business every 1st

**What:** The plan's trigger for the brand-new-business card is `sales.thisMonth.count === 0`. On the
first of any month an established shop has not yet sold anything *this month*, so it would be
greeted with "Record your first sale".

**Evidence:** Plan Task 11 Step 4. `sales.thisMonth` is the month-to-date aggregate
(`DashboardSalesTotals`), not a lifetime one.

**So what:** `overview.tsx` also requires every bucket of `trend7.series` to have `count === 0`.
The seven days are already in the payload, so it costs nothing, and it makes the card appear only
when there is genuinely nothing anywhere behind it. The plan's own Task 11 fixture (`series: []`)
still triggers it, so the given test is unchanged.

## The canvas is silent about the other panels on day one

**What:** Artboard `1e`'s brand-new-business column shows exactly two things — First steps and
"Nothing to chart yet". It does not say what happens to Debts, Stock, Staff, Projects,
Announcements and Team, all of which a new owner's `GET /dashboard` still returns (empty).

**Evidence:** `docs/design/TradeOs-UI.dc.html:2630-2661`.

**So what:** Followed the plan literally — First steps replaces the **stat grid**, "Nothing to chart
yet" replaces the **trend strip**, and every other panel renders with its own empty state, as brief
§8.4 requires of each. The result on day one is a long page of calm empty panels. If the owner would
rather suppress them until the first sale, that is one condition in `overview.tsx` and no change to
any panel — but it is a product decision, not an implementation detail, so it was not taken here.

## `sales` carries six numbers and the canvas has four cards

**What:** `sales.today` and `sales.thisMonth` each carry `revenue`, `grossProfit` and `count`; `1c`
draws four stat cards with a `+0.94% · vs last week` footer.

**Evidence:** `docs/design/TradeOs-UI.dc.html:2130-2180`; `DashboardSalesTotals`.

**So what:** Nothing is dropped: the month's count rides in the fourth card's delta and the month's
gross profit in its foot note. The canvas's percentage delta is **not** rendered, because the only
comparison available is `trend7`, whose last bucket is *today so far* — comparing a partial day with
a whole one would print a collapse every morning. The one derived figure on the grid is today's
gross margin, computed from the two numbers printed on its own card, so it cannot disagree with
anything else on the page.

## `formatMoney` does not fit the chart's axis gutter

**What:** `BarChart`'s `axisLabels` are drawn in a 10px mono column the canvas sizes at roughly
30px wide. `formatMoney(20320, "USD")` is `USD 20,320.00` — about four times that.

**Evidence:** `docs/design/TradeOs-UI.dc.html:2185` (the axis column, `flex:none`, 10px mono);
`lib/format/money.ts`.

**So what:** The five ticks are compact (`20.3k`, `1.2M`) and the unit is stated once, in the legend
beside the chart title, which reads `Revenue · USD` when the metric is money and drops the code when
the business has none. Amounts a person acts on — every stat card, every table cell — still go
through `formatMoney` with the code, as the rule requires. The `…` menu the canvas draws beside the
segmented control is omitted rather than rendered inert: nothing in this slice can sit behind it.

## `useOrganization()` costs a request the dashboard has already answered

**What:** The Overview calls `useOrganization()` for `timezone` and `currency`, which fires
`GET /organizations/current/currency`. The same page's `GET /dashboard` response already contains
`sections.organization.timezone` and `sections.organization.currency` — both facts, in a request it
was making anyway.

**Evidence:** `features/organization/hooks/use-organization.ts` (the second query);
`DashboardOrganizationSection` in `features/dashboard/types.ts`.

**So what:** Left as the plan specifies, because `useOrganization()` is the one place the rest of the
app will read these from and its currency query is cached for 30 minutes, so the cost is one extra
request per session rather than per page. Worth revisiting only if the Overview ever becomes the
first screen a session loads — then the currency arrives twice on the critical path.

## A null currency is stated, not guessed

**What:** `organization.currency` on the wire is `{ main, exchange, rate } | null`, and
`useOrganization()` deliberately falls back to `""` rather than `"USD"`. A business with no currency
configuration therefore has no code to give `formatMoney`.

**Evidence:** `features/organization/hooks/use-organization.ts`, the `LOADING_CURRENCY` comment.

**So what:** `overview.tsx` binds one `money()` for the whole page: `formatMoney(amount, "")` renders
`" 4,120.25"`, which is trimmed, and a `CurrencyNotice` at the top of the page says the amounts are
shown without a currency code and links to Settings. Every panel takes `money` as a prop rather than
a currency string, so there is exactly one place this policy lives and no panel can quietly reinvent
it. The notice is gated on `!isLoading`, so a slow currency query shows a skeleton rather than a
false alarm.

## Two sections have no place on the canvas at all

**What:** `sections.me` and `sections.organization` are ungated — every caller gets them — and
neither appears anywhere on artboards `1c`, `1d` or `1e`. `me.name` / `me.role` are the sidebar's,
`organization.name` / `logo` are the org menu's, and both live in the shell (Task 8), which reads
them from the session instead.

**Evidence:** `DashboardMeSection` and `DashboardOrganizationSection`; the sidebar blocks at
`docs/design/TradeOs-UI.dc.html:2058-2092`.

**So what:** The Overview reads neither, and that is correct rather than an oversight: the shell has
the same facts from `GET /auth/me` before the dashboard request resolves, so using the dashboard's
copy would make the header pop in a beat later. Recorded so the next person does not go looking for
where `me.permissions` is consumed — it is not, `useCan` is.

## The given test needs one mock the plan does not list

**What:** The plan's `overview.test.tsx` mocks `use-organization` and `use-dashboard` only. `Overview`
gates the "New sale" button and the First-steps rows on `useCan`, which reads `useSession`, which
would fire a real `GET /auth/me` out of happy-dom on every render.

**Evidence:** `features/auth/hooks/use-permission.ts` → `use-session.ts` → `lib/api/client.ts`.

**So what:** `features/dashboard/components/overview.test.tsx` adds
`vi.mock("@/features/auth/hooks/use-permission")` granting everything, with a comment saying why.
The three tests themselves are the plan's, unchanged. Any later Overview test that asserts a
permission-gated element is *absent* must narrow that mock, or it will be asserting about a stubbed
session rather than about the data.

## Two small structural choices the file list forced

**What:** (1) The labelled mono figure the Debts, Stock, Team and My-sales panels all draw is
exported as `PanelFigure` from `debts-section.tsx`. (2) `staff-section.tsx` has its own three-line
`initials()` rather than importing `getInitials` from `components/layout/nav-utils.ts`.

**Evidence:** Task 11's file list is exactly ten components with no room for a shared file;
`components/layout/**` was being edited in parallel by another agent.

**So what:** Neither is where it belongs long-term. If a fifth caller for the figure appears outside
this feature, lift it to `components/shared/`; if a third caller wants initials, lift one copy to
`lib/`. Both are flagged in comments at the definition site.

## Biome's `useSemanticElements` rejects `role="status"` and `role="group"`

**What:** `bunx biome check` fails an ARIA role that has a native element: `role="status"` must be
`<output>`, and `role="group"` must be `<fieldset>`. `role="alert"` is accepted (`error-card.tsx`
uses it), so the rule is not blanket.

**Evidence:** `biome.json` enables `recommended` with the `react` domain; the two errors were
`lint/a11y/useSemanticElements` on `overview.tsx:279` and `sales-section.tsx:177`.

**So what:** The currency notice is an `<output>` and the trend segmented control a `<fieldset>` with
an `sr-only` `<legend>`. Worth knowing before reaching for a role attribute anywhere else in this
codebase — the fix is always the native element, not a suppression.
