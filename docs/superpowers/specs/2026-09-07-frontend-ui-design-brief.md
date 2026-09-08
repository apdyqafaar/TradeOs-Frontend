# TradeOs — Frontend UI Design Brief

*Written 2026-09-07 for the AI designer agent. This is the complete context: what the product is, what the backend can do, the approved navigation, every screen, and the visual direction. Design from this document alone; ask before inventing a screen or a field that is not here.*

---

## 0. How to read this

1. **§1–2** tell you what TradeOs is and who uses it. Read them first — most layout decisions follow from the three roles.
2. **§3–4** are the visual direction and tokens. The two reference screenshots (`Screenshot_20260810_163935_TikTok.jpg` dark, `Screenshot_20260810_163942_TikTok.jpg` light) show the *structure and feel* we want; the *colours* come from §3.2 (a Claude-like warm palette), not from the screenshots.
3. **§5** is the approved navigation. It is final — do not add, rename or regroup menu items.
4. **§6** is one block per screen. Every field named there exists in the backend; nothing else does.
5. **§7–9** are shared components, data-display rules and copy tone.
6. **§10** is the list of frames to produce, in priority order.

Everything the UI shows comes from the REST API described in `Backend/docs/BACKEND-GUIDE.md`. When this brief and that guide disagree, the guide wins.

---

## 1. The product

**TradeOs is a multi-tenant SaaS for small trading businesses** — shops, wholesalers, small service providers, typically in East Africa (Somali / Swahili / Arabic-speaking markets are expected; design for names and addresses in non-Latin scripts and for two currencies at once).

- One **organization** = one business. A user belongs to one organization at a time. The UI never shows or asks for an organization id.
- Every business has a **main currency** and one **exchange currency** with a rate (e.g. USD main, KES exchange at 130). Every stored amount is in the main currency; a sale or payment may be *tendered* in either, and the rate in force is frozen on that record.
- **Money has 2 decimals, quantities up to 3.** Nothing about money is ever deleted: a mistake is corrected by a *void* or a *write-off*, and the original stays visible.
- The frontend is **Next.js 16 (App Router) + Tailwind v4 + shadcn (base-nova style) + lucide icons**, with Geist Sans and Geist Mono already loaded. Design in those primitives.

### 1.1 The three roles (and why they shape every screen)

Permissions are strings like `products:create`. `GET /auth/me` returns the caller's list, and **the UI hides what the caller cannot do** (it does not show disabled buttons for missing permissions — it shows nothing). Three preset roles exist in every business; custom roles can be built from the same 43 permissions.

| Role | Who | What they see |
|---|---|---|
| **Owner** | The business owner | Everything |
| **Manager** | Trusted staff | Everything except deleting the business |
| **Seller** | The person at the counter | Overview (their own figures), **New sale**, Products (view only), Customers (view, create **and edit**), Debts (view + take payments), Announcements, Projects (view). Also holds `members:view` — for sale attribution, *not* for managing the team. **No** Reports, Roles, Settings, uploads, and no Members management page. |

Design consequence: **the same shell serves all three.** A Seller sees 7 sidebar items; a Manager sees 11. The counter (`/sales/new`) is the single most-used screen in the product and must be fast on a tablet.

### 1.2 The money loop

```
New sale ──► stock moves ──► fully paid?  ──yes──► receipt S-000123
                               │
                               no ──► debt created (needs customer + due date)
                                        │
                                        ├─► payments (partial, either currency)
                                        ├─► overdue when open ∧ past due ∧ balance > 0
                                        └─► write-off (manager, reason) / cancelled by void
```

---

## 2. What the backend provides (endpoint → screen)

Every route is under `/api/v1`. Lists are paginated (`?page=&limit=`, max 100). Errors carry a machine `code` and, for 422, `errors: { field: message }`.

| Endpoint family | Screen(s) |
|---|---|
| `POST /auth/register`, `/login`, `/logout`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`, `/accept-invite`, `/2fa/challenge`, `/passkeys/login/*` | Auth pages (§6.1) |
| `POST /organizations` | Onboarding (§6.2) |
| `GET /auth/me` | Shell (menu filtering, avatar, org name) |
| `GET /dashboard` | Overview (§6.3) |
| `GET/POST /sales`, `GET /sales/:id`, `POST /sales/:id/void`, `GET /products/barcode/:code` | Sales list, New sale, Receipt (§6.4) |
| `GET/POST /products`, `GET/PATCH/DELETE /products/:id`, `POST /:id/stock`, `GET /:id/stock-movements` | Products (§6.5) |
| `GET/POST/GET/PATCH/DELETE /categories` | Products → Categories tab |
| `/products/import/*` (10 endpoints) | Products → Import (§6.5.4) |
| `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id` | Customers (§6.6) |
| `GET/POST /debts`, `GET /debts/:id`, `GET/POST /debts/:id/payments`, `POST /debts/:id/write-off`, `POST /payments/:id/void` | Debts (§6.7) |
| `GET /reports/sales/{summary,trend,payment-mix}`, `/products/{top,stock,dead}`, `/staff/sales`, `/debts/{summary,ageing}`, `/customers/top` | Reports (§6.8) |
| `/announcements` CRUD | Announcements (§6.9) |
| `/projects` CRUD, `/:id/updates`, `/:id/publish`, `/unpublish`, `/regenerate-link` | Projects (§6.10) |
| `GET /public/projects/:token` | Public project page (§6.10.3) |
| `GET /members`, `POST /members/invite`, `POST /:id/resend-invite`, `PATCH /:id`, `DELETE /:id` | Members (§6.11) |
| `/roles` CRUD | Roles (§6.11.2) |
| `GET/PATCH /organizations/current`, `GET/PATCH /organizations/current/currency` | Settings (§6.12) |
| `PATCH /users/me`, `POST /auth/change-password`, `/2fa/setup`, `/2fa/verify`, `/2fa/disable`, `GET/DELETE /auth/passkeys`, `GET /auth/sessions`, `POST /auth/logout-others`, `/logout-all`, `DELETE /auth/account` | Account (§6.13) |
| `GET/POST/DELETE /uploads` | Image picker component (§7) |

**Not in the backend (do not design as working features):** billing/subscriptions, OAuth (“Continue with Google”), AI report narratives, notifications, expenses, exports (PDF/CSV), audit log, deleting an organization, ownership transfer, photos on project updates.

---

## 3. Visual direction

### 3.1 The reference screenshots — what to take, what to leave

The two screenshots show a dashboard in dark and light. Take the **structure**:

- **Left sidebar ~240 px** with an organization block at the top (logo square · small “Agency”-style label · business name · chevron), then **grouped menu items** with small group labels, thin separators between groups, line icons, and the active item as a soft filled pill with a filled icon.
- **Top bar**: breadcrumb on the left (`Dashboard › Overview`, current crumb in the accent colour), search on the right.
- **Page heading** “Welcome back, Salung” — large, friendly, no subtitle.
- **Stat cards**: uppercase **monospace** label (`TOTAL REVENUE`), a big monospace number (`$20,320`), a tiny sparkline of bars on the right, and a footer row (info icon · `+0.94% last year` delta in green). Cards have a subtle inset/double-border feel.
- **Section header strip**: uppercase monospace title with an info icon, `…` menu at the right.
- **Chart**: a bar chart drawn as **stacked small squares on a dotted grid** (LED / dot-matrix feel), segmented control `Weekly · Monthly · Yearly`, legend dots, hover tooltip listing the series, uppercase mono month labels.
- **Data table**: checkbox column, uppercase mono sortable headers, status pill (`● Success`), compact rows.
- Rounded corners ~10–12 px, hairline borders, generous but not loose spacing, a mono/sans pairing where **mono = data, sans = navigation and prose**.

Leave behind:

- The **colours**. The screenshots are neutral grey/black with a pure orange; ours is the warm Claude-like palette in §3.2.
- The **menu items** (Messages, Campaigns, Channels, Order Management, Integrations, Billing) — ours are in §5.
- The floating TikTok overlays (heart, `+` button, avatar circle, `452`) — video-app UI, not part of the design.

### 3.2 The theme: “Claude-like”

Warm, calm, paper-like. Cream instead of white, warm charcoal instead of black, a single terracotta accent, serif for display headings, sans for everything else, mono for numbers.

**Light**

| Token | Value (approx.) | Use |
|---|---|---|
| `bg` | `#F5F4EE` | page ground (cream) |
| `surface` | `#FBFAF7` | cards, sidebar |
| `surface-2` | `#F0EEE6` | table header rows, hover, inset areas |
| `border` | `#E3E1D8` | hairlines |
| `text` | `#1F1E1D` | primary text (warm near-black) |
| `text-muted` | `#6E6D68` | labels, secondary |
| `accent` | `#D97757` | primary buttons, active nav, links, chart bars |
| `accent-hover` | `#C4643F` | |
| `accent-soft` | `#F6E7DF` | active-nav pill, accent tints |
| `success` | `#4F8A5B` / soft `#E4EFE5` | paid, in stock, success pills |
| `warning` | `#B8862B` / soft `#F5ECD6` | partial, on hold, low stock, invited |
| `danger` | `#C0392B` / soft `#F6E0DC` | overdue, out of stock, destructive |
| `info` | `#5B7A9D` / soft `#E3EAF2` | credit, planned, neutral highlights |

**Dark**

| Token | Value (approx.) | Use |
|---|---|---|
| `bg` | `#1C1B19` | page ground (warm charcoal) |
| `surface` | `#262421` | cards, sidebar |
| `surface-2` | `#2F2D29` | table header, hover |
| `border` | `#3A3833` | hairlines |
| `text` | `#EDEBE5` | |
| `text-muted` | `#A19F98` | |
| `accent` | `#E08A6B` (slightly lifted terracotta) | |
| `accent-soft` | `#3B2B25` | |
| status colours | same hues, lifted ~15% lightness; soft variants as translucent tints |

Never pure `#FFFFFF` or `#000000`. The accent is the *only* saturated colour on a page apart from status pills and chart series.

**Typography**

| Role | Face | Where |
|---|---|---|
| Display serif | *Instrument Serif* or *Source Serif 4* (Google) — a Tiempos-like editorial serif | Page greetings (“Welcome back, Amina”), auth headline, empty-state titles, public project title. Regular weight, tight leading. |
| Sans | **Geist** (already loaded) | Navigation, body, forms, buttons, table cells that are words |
| Mono | **Geist Mono** (already loaded) | All numbers and money, card labels (uppercase, letter-spaced), table headers, receipt numbers, barcodes, dates in tables, axis labels |

Sizes: page title 28/32 serif; section strip label 12 mono uppercase tracking +0.08em; stat number 28–32 mono; body 14; table 13; caption 12.

**Shape & depth**: radius 10 px (cards, inputs), 8 px (pills, chips), 14 px (dialogs). No drop shadows on cards — hairline borders and a one-step surface change do the lifting. Dialogs and popovers get one soft shadow. Focus ring is the accent at 2 px.

**Chart style** (from the screenshots, recoloured): bars built from small rounded squares on a dotted grid; single-series bars in `accent`, second series in `text-muted`; dark mode uses the same. Tooltip is a small card with a mono value list. Sparklines in stat cards are 12–16 thin bars in `accent` with the last bar full-opacity.

**Icons**: lucide, 18 px in nav and tables, 16 px inline, 1.5 px stroke.

**Density**: comfortable on desktop (row height 44 px); the counter and the debt-payment dialog get a **touch density** variant (48 px targets) because they are used standing at a counter on a tablet.

### 3.3 Auth pages: claude.ai-like

The login and register pages mirror the feel of claude.ai’s sign-in: **one centred column on the cream ground, no split-screen illustration, no marketing copy.**

- Wordmark top-left (`TradeOs`, sans, small). Optional theme toggle top-right.
- Centred column, max 400 px, vertically centred.
- A **serif headline** (`Your business, in order.` — 34–40 px, regular weight) and one muted line under it.
- Fields stacked full-width, 44 px tall, labels above, generous 16 px gaps.
- One full-width **accent** primary button (`Continue`), then a hairline `or` divider, then a secondary outline button **`Sign in with a passkey`** (login only).
- **No “Continue with Google”** — the backend has no OAuth. Do not draw it, even greyed.
- Under the form: a single switch line (`New to TradeOs? Create an account` / `Already have an account? Sign in`) and a two-line muted legal footer.
- Error states appear as a soft `danger` banner above the fields, plus field-level messages for 422s.

---

## 4. The app shell

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ ▣ Business │  Sales › New sale                              [🔍 Search ⌘K]  ● │
│ Spark Ltd ▾├──────────────────────────────────────────────────────────────┤
│            │                                                              │
│ MAIN       │   Page title                                   [Primary CTA] │
│ ● Overview │   ───────────────────────────────────────────────────────    │
│   Sales    │                                                              │
│   Products │                    page content                              │
│   Customers│                                                              │
│   Debts    │                                                              │
│   Reports  │                                                              │
│            │                                                              │
│ TEAM       │                                                              │
│   Announce.│                                                              │
│   Projects │                                                              │
│            │                                                              │
│ MANAGE     │                                                              │
│   Members  │                                                              │
│   Settings │                                                              │
│            │                                                              │
│ ────────── │                                                              │
│ ? Help     │                                                              │
│ ◯ Amina  ▾ │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

- **Sidebar** (240 px, `surface`, right hairline). Org block at top: logo (or initial in an accent-soft square) · tiny muted label `Business` · name · chevron; clicking opens a menu with *Settings* (if permitted) and *Log out*. Group labels are 11 px sans uppercase muted. Items: icon + label, 36 px tall, active = `accent-soft` pill with `accent` icon and text. Footer: **Help Center**, then the **avatar row** (initials · name · role name under it in muted) opening *Account* / *Log out*. Sidebar collapses to a 64 px icon rail on ≥1024 px and becomes a drawer below 1024 px.
- **Top bar** (56 px): breadcrumb left (parent crumbs muted, current in `accent`), global search right (`⌘K`, searches products, customers, sales by receipt number), theme toggle, and — when the user’s email is unverified — a slim `warning` strip under the top bar with a *Resend verification* link.
- **Content** max-width 1280 px, 32 px padding; page title row = serif title + optional muted count + right-aligned primary CTA and filter controls.
- **Tabs** inside a page are underline tabs under the title row (Products: `All · Low stock · Categories · Import`).
- **Mobile (< 768 px)**: drawer sidebar, breadcrumb replaced by a back arrow + title, tables become card lists, the counter becomes a two-step flow (pick products → cart & payment).

---

## 5. Navigation (approved, final)

Visibility is decided by permission; the item is **absent**, not disabled, when the caller lacks it.

| Group | Item | Route | Visible when | Notes |
|---|---|---|---|---|
| MAIN | Overview | `/overview` | always | |
| MAIN | Sales | `/sales` | `sales:view` | **New sale** button needs `sales:create` |
| MAIN | Products | `/products` | `products:view` | tabs: All · Low stock · Categories · Import |
| MAIN | Customers | `/customers` | `customers:view` | |
| MAIN | Debts | `/debts` | `debts:view` | tabs: Open · Overdue · Paid · Written off · Cancelled |
| MAIN | Reports | `/reports` | `reports:view` | sub-pages: Sales · Products · Debts · Customers · Staff |
| TEAM | Announcements | `/announcements` | always | |
| TEAM | Projects | `/projects` | `projects:view` | |
| MANAGE | Members | `/team` | `members:invite` | **not** `members:view` — the backend's Seller preset holds `members:view` (a seller must see who recorded a sale), so gating on it would show this page to counter staff. Sub-page **Roles** `/team/roles` needs `roles:view`. |
| MANAGE | Settings | `/settings` | `organization:update` | tabs: Business · Currency |
| footer | Help Center | `/help` | always | |
| avatar | Account | `/account` | always | tabs: Profile · Security · Sessions |

Outside the shell: `/login`, `/login/2fa`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/onboarding`, `/p/[token]`.

Seller sees: Overview, Sales, Products, Customers, Debts, Announcements, Projects, Help, Account. Manager/Owner see all.

---

## 6. Screens

Each block: **Purpose · Who · Layout · Content · Actions · States · Rules.** Fields in `code` are the API’s names.

### 6.1 Auth

**Login** `/login` — email, password, `Continue`; `Forgot password?` link right-aligned under the password field; `or` divider; `Sign in with a passkey`. On success: if the response says `twoFactorRequired: true` (it carries a short-lived `challengeToken`, not a session) → `/login/2fa`; if `organization` is null → `/onboarding`; else `/overview`. Errors: `UNAUTHORIZED` banner “Wrong email or password”; `TOO_MANY_REQUESTS` (429) banner “Too many attempts — try again in a few minutes.”

**2FA step** `/login/2fa` — same column; headline `Enter your code`; six-box code input, auto-advance, `Verify`. Muted line: “Open your authenticator app.” Back link to login.

**Register** `/register` — name, email, password (strength hint under the field), `Create account`. On success: a **“Check your email”** panel (serif headline, envelope icon, the address, `Resend` link with a 60 s cooldown). The user can still proceed to `/onboarding` — the app shows the unverified strip until they verify — **but creating a business requires a verified email**, so the onboarding CTA is blocked with an inline explanation until then.

**Verify email** `/verify-email?token=` — auto-submits; shows a success panel with `Continue`, or an expired-token panel with `Resend`.

**Forgot / Reset password** — single email field → “If that address exists, we sent a link” (same message either way, by design); reset page has new password + confirm.

**Accept invite** `/accept-invite?token=` — headline `Join {Business name}`; shows the inviter’s business name and the role; fields: name, password. Creates the account and membership in one step → `/overview`. Expired-token panel with “Ask your manager to resend the invite.”

### 6.2 Onboarding `/onboarding`

One centred card (same claude.ai feel), three steps with a thin progress line:

1. **Your business** — `name`, `timezone` (searchable select, defaults to the browser’s zone).
2. **Currency** — `mainCurrency` (ISO-4217 select with flag + code), `exchangeCurrency`, `exchangeRate` (mono input, helper “1 USD = 130 KES”). All three are required by `POST /organizations`.
3. **Invite your team** (optional, skippable) — up to 3 email + role rows; role select = Manager / Seller.

Finish → `/overview` with a one-time welcome toast. Blocked with an inline notice if `emailVerified` is false.

### 6.3 Overview `/overview`

**Purpose**: the morning glance. **Data**: one call, `GET /dashboard`, which returns only the sections the caller may see — design the page as a **stack of optional sections** that collapse away cleanly.

Layout, top to bottom:

1. Serif greeting `Good morning, Amina` + muted date in the org timezone. Right: primary CTA **New sale** (if `sales:create`).
2. **Stat cards row** (4 cards, from `sales`): `Today’s revenue`, `Today’s profit`, `Sales today` (count), `This month` (revenue). Each with the sparkline (from `trend.series`) and a muted footer line. Seller instead gets **`mySales`**: `My sales today` (count + total), `This month`, and a short list of their recent receipts.
3. **Sales trend** section strip (the dot-matrix chart, last 7 days from `sales.trend`, segmented `Revenue · Profit · Count`).
4. Two-column band:
   - **Debts** (`debts`): outstanding total, overdue amount + count, and a compact table of the top overdue customers (`customer.name`, `remaining`, `daysOverdue` badge, due date). Row → debt detail.
   - **Stock** (`stock`): low-stock count, out-of-stock count, and a 5-row list (`name`, `quantity`, `threshold`). Link → Products › Low stock.
5. Second band: **Staff today** (`staff`: top 5 members by sales count/revenue, avatar initials bar) and **Projects** (`projects`: in-progress count + due-soon list with progress bars).
6. **Announcements** (`announcements`: pinned first; title, author, relative time) and **Team** (`team`: active count, invited count) as small cards.

Empty variants matter here: a brand-new business has zero everything — show a **“First steps”** checklist card (Add a product · Record your first sale · Invite a teammate) in place of the stat cards until the first sale exists.

### 6.4 Sales

**Sales list** `/sales` — table: `number` (mono, `S-000123`), date/time, customer (or `Walk-in`), items count, `total` (mono, right-aligned), payment status pill (`paid` / `partial` / `credit`), `soldBy`, `status` (voided rows are muted with a strikethrough total). Filters: date range, `paymentStatus`, `status` (completed / voided / all), search by receipt number. CTA **New sale**.

**New sale (the counter)** `/sales/new` — full-width two-pane, touch density.

- **Left (60%)**: search input with barcode focus (a scanner types + Enter → `GET /products/barcode/:code` → adds the line); category chips row; product grid (image thumb, name, mono price, stock badge or `Untracked`); out-of-stock tiles are dimmed but visible.
- **Right (40%, sticky)**: **cart**. Line = name, `quantity` stepper (3 dp allowed, unit shown), `unitPrice` (editable override), line `discount`, mono `lineTotal`. Below: `subtotal`, sale-level `discount`, **`total`** (large mono). Then **Payment**: currency toggle (`USD` | `KES`, exchange shows the frozen rate), `amountTendered` (mono), computed `change` or `amountDue`. If `amountDue > 0` the panel expands: **Customer** (search + quick-create sheet; required) and **`dueDate`** (date picker, today or later). Optional `note`. Big accent button **`Complete sale`** — label changes to `Complete · credit` when there is a balance.
- After success → **Receipt** view (below) with a `New sale` button that returns here with an empty cart.

Rules to design for: adding more than available stock is refused (`INSUFFICIENT_STOCK`) — show the available quantity inline on the line; an archived customer cannot be chosen for credit; due date cannot be in the past.

**Receipt / sale detail** `/sales/[id]` — a receipt-shaped card, max 720 px: header with `number` (mono, large), status pill, date, `soldBy`; customer block; items table (name, qty × unit, unit price, discount, line total); totals block; **Payment** block (`currency`, `exchangeRate` frozen, `amountTendered`, `amountPaidMain`, `change`, `amountDue`, `dueDate`) with a link to the debt when one exists; `note`. Actions (top-right): **Print**, **Void** (`sales:void`; opens a dialog requiring a `reason`; disabled with a tooltip “A payment has been taken on this sale’s debt” when the API would answer `DEBT_HAS_PAYMENTS`). A voided sale shows a `danger`-soft banner: reason · who · when.

### 6.5 Products

**6.5.1 List** `/products` (tab **All**) — table: thumb, `name` (+ `barcode` mono under it), category, `unit`, `costPrice`, `sellingPrice`, **stock** column (mono `quantity` with a `warning` pill `Low` when ≤ threshold, `danger` `Out` at 0, or muted `Untracked`), status. Filters: search, `categoryId`, `status` (active / archived / all). CTAs: **New product**, secondary **Import**. Tab **Low stock** is the same table pre-filtered with `lowStock=true`, sorted by quantity.

**6.5.2 Product form** `/products/new`, edit in a side sheet on detail — sections: *Basics* (`name`, `barcode` — unique per business, `DUPLICATE_BARCODE` shows inline —, `categoryId`, `unit` select with free entry, `description`); *Pricing* (`costPrice`, `sellingPrice`, computed margin shown muted); *Stock* (`trackStock` switch → reveals `quantity` (initial only) and `lowStockThreshold`); *Images* (up to 5, via the image picker — hidden for users without `uploads:create`).

**6.5.3 Detail** `/products/[id]` — left: image gallery (main + thumbs); right: fields card and a **Stock card** (large mono quantity, threshold, `Restock` and `Adjust` buttons → dialog: type `restock` | `adjustment`, `quantity` (signed for adjustment), `reason` required). Below: **Stock movements** table (`type` pill: sale / sale_void / restock / adjustment, signed quantity, resulting quantity, who, when, reason or receipt link). Untracked products show the stock card replaced by a muted note. Header actions: Edit, Archive/Delete (`products:delete`).

**6.5.4 Categories** tab — simple list card: name, product count, `General` marked with a lock and no delete. Inline create; rename in place; delete is refused with an inline notice when in use (`CATEGORY_IN_USE`).

**6.5.5 Import** tab and `/products/import/[jobId]` — a four-step stepper:

1. **Upload** — drop zone (CSV or XLSX, ≤ 2,000 rows, ≤ 5 MB) and a `Download template` link. Below: a list of previous jobs (`format`, rows, `status`: reviewing / committed / cancelled, created, expires in N days).
2. **Map columns** — two-column mapper: detected header → product field select (`name`, `barcode`, `category`, `unit`, `costPrice`, `sellingPrice`, `quantity`, `lowStockThreshold`, `description`), pre-filled by alias matching; unmapped headers shown muted.
3. **Review rows** — count chips as tabs: `Ready · Needs attention · Conflict · Skipped`. Table with row index, mapped values, and a message column. A row with errors opens an inline edit; a **Conflict** row (barcode already exists) shows the existing product beside it with `Skip` / `Update existing` choices; any row has `Skip`.
4. **Commit** — summary (`N ready, M skipped, K conflicts resolved`), a note that unknown categories will be created (only shown when the user has `categories:create`; otherwise: “Rows with unknown categories need attention”), and **`Import N products`** — disabled while any row is `needs_attention`. Success panel with counts and a link to Products.

### 6.6 Customers

**List** `/customers` — table: `name`, `phone` (mono), `email`, `address` (truncated), created, status. No balance column — the list endpoint does not return one; balances live on the detail. Filters: search, `status`. CTA **New customer** (`customers:create`). Sellers use the same list.

**Form** — sheet: `name`, `phone` (unique per business — `DUPLICATE_PHONE` shows inline on the field), `email`, `address`, `notes`. The same sheet is the **quick-create** from the counter.

**Detail** `/customers/[id]` — header: name, phone, email, address, status, `Archive` (`customers:delete`; refused with an inline notice while the customer has an open debt — `CUSTOMER_HAS_OPEN_DEBT`). **Debt summary card** from the detail response’s `debtSummary` (outstanding, overdue). Tabs: **Debts** (their debt rows, same columns as §6.7) and **Sales** (their receipts). Archived customers show a muted banner: “Archived — cannot be sold to on credit.”

### 6.7 Debts

**List** `/debts` — tabs by `status` (`open`, `overdue`, `paid`, `written_off`, `cancelled`). Columns: customer (name + phone), source (`Sale S-000123` link or `Manual: description`), `principal`, `paid`, `remaining` (mono), `dueDate` with a `daysOverdue` badge on overdue rows, status pill. Search by customer. CTA **New debt** (`debts:create`) → sheet: customer, `principal` amount, `dueDate`, `description`.

**Detail** `/debts/[id]` — top: customer block + status pill; **balance card** with four mono figures — `principal`, `paid`, `remaining`, `writtenOffAmount` — and a thin progress bar (paid ÷ principal). **Payments timeline**: each payment shows amount (tendered `currency` + frozen `exchangeRate`, and the main-currency value), who, when, note; voided payments are struck through with reason. Actions: **Record payment** (`payments:create`; dialog: amount, currency toggle, note; shows the new remaining before confirming; an amount above the balance is refused — `PAYMENT_EXCEEDS_BALANCE` — so cap the input and offer a `Pay in full` shortcut), **Write off** (`debts:write_off`; dialog with required reason; explains the remaining balance will be recorded as written off), and on each payment **Void** (`payments:void`; reason; restores the balance and reopens a paid debt).

Vocabulary rule: **Cancelled ≠ Written off.** Cancelled means the sale was voided (paid 0 / remaining 0). Written off means the manager forgave the balance. Use both words exactly as here.

### 6.8 Reports `/reports/*`

A shared **period bar** sits under the title on every sub-page: segmented `Today · Week · Month · Year` plus a `Custom` date-range popover (`from`/`to`, calendar dates in the business timezone). Point-in-time reports (stock value, debt ageing) hide the bar.

Reserve, on every sub-page, a **`Highlights`** card at the top (serif, two or three sentences). Design it but mark it *coming later* — AI narratives are not built yet.

- **Sales** `/reports/sales` — summary cards (revenue, gross profit, sales count, average sale); **trend** chart with `granularity` `day · week · month`; **payment mix** (two donut/bars: cash vs credit; main vs exchange currency).
- **Products** `/reports/products` — **top products** table (`by` `revenue · quantity`, `limit` 10/25/50) with bar cells; **stock value** card (point-in-time: total cost value, total selling value, tracked count); **dead stock** table (`days` 30 / 60 / 90 toggle: product, quantity, value, last sold).
- **Debts** `/reports/debts` — summary cards (outstanding, overdue, collected in period, written off in period); **ageing** bar chart with five buckets `Current · 1–30 · 31–60 · 61–90 · 90+` (count + amount).
- **Customers** `/reports/customers` — **top customers** (`by` `spend · balance`, limit) with a spend bar cell.
- **Staff** `/reports/staff` — sales per member: name, count, revenue, average; a horizontal bar.

Every chart uses the dot-matrix bar style; tables get an `Export` button designed but disabled (“Coming soon”).

### 6.9 Announcements

**List** `/announcements` — cards: cover (16:9, optional), pinned pin icon, `title`, author + relative time, 2-line body excerpt. Pinned first. CTA **New announcement** (`announcements:create`).

**Detail** `/announcements/[id]` — reading layout, max 720 px: cover, serif title, author row, body (plain text with paragraphs). Actions: Edit, Pin/Unpin, Delete.

**Form** — sheet: `title`, `body` (textarea, 5,000 chars), cover image (picker), `pinned` switch.

### 6.10 Projects

**6.10.1 List** `/projects` — card grid (cover, `title`, customer name, status pill, thin `progress` bar with %, `dueDate`, a small `Published` link-icon badge). Filter by `status`; search. CTA **New project** (`projects:create`).

**6.10.2 Detail** `/projects/[id]` — header: cover banner, serif title, status select (inline change with `projects:update`), progress ring, `startDate` → `dueDate`, customer chip. Two columns: left **Description** and the **Updates** timeline (each: `body`, optional `progress` chip “→ 60%”, author, date; a composer at the top with body + progress slider; updates are never edited — show a `Delete` only). Right: **Share card** — when unpublished: `Publish` (`projects:publish`) with the explanation “Creates a link your client can open without an account”; when published: the link in a mono read-only field with `Copy`, `Regenerate link` (old link stops working), `Unpublish`.

**6.10.3 Public project page** `/p/[token]` — no shell. Cream ground, centred 720 px column: business logo + name, serif project title, status pill, progress bar, dates, cover, description, updates timeline (read-only). Footer: “Shared via TradeOs”. Not-found / revoked state: a calm centred message.

### 6.11 Members & Roles

**6.11.1 Members** `/team` — table: avatar initials + name + email (invited rows show only `invitedEmail` and an `Invited` `warning` pill), role (inline select with `members:update`), status, joined date. Row menu: `Resend invite` (invited only), `Remove` (`members:remove`, confirm dialog). CTA **Invite** (`members:invite`) → dialog: email, role select. Owner row is locked (no role change, no remove).

**6.11.2 Roles** `/team/roles` — list: `name`, `description`, permission count, `Preset` lock badge on Owner / Manager / Seller (not editable, not deletable), custom roles editable. CTA **New role** (`roles:create`).

**Role editor** `/team/roles/[id]` — `name`, `description`, then a **permission matrix**: one row per resource (organization, roles, members, customers, categories, products, sales, debts, payments, reports, announcements, projects, uploads) × actions (view / create / update / delete / plus the specials: `adjust_stock`, `void`, `write_off`, `invite`, `remove`, `publish`). Checkboxes with a “select row” toggle. Preset roles open the same matrix read-only with a note.

### 6.12 Settings

Tabs **Business** and **Currency**; visible to `organization:update`.

- **Business** — logo (upload square, 1:1, picker with `purpose: logo`), `name`, `timezone`, `phone`, `address`. Save button sticky at the bottom.
- **Currency** — `mainCurrency`, `exchangeCurrency`, `exchangeRate` with a live example line (“1 USD = 130 KES”). An `info` callout: “Changing the rate affects new sales and payments only; existing records keep the rate they were made at.”

No danger zone: the backend has no delete-organization route yet.

### 6.13 Account `/account`

Tabs **Profile · Security · Sessions**.

- **Profile** — avatar `image` (URL or picker), `name`, email (read-only with a `Verified` / `Unverified` pill and a resend link).
- **Security** — **Password** card (current, new, confirm). **Two-factor** card: off → `Set up` (dialog: QR code + manual key, then a six-box verify step, then a one-time recovery notice); on → `Enabled` with `Disable` (requires password). **Passkeys** card: list (`label`, created, `lastUsedAt`) with `Remove`, and `Add a passkey` (asks for a label first). **Danger zone**: `Delete account` (dialog: type the email to confirm).
- **Sessions** — list of active sessions (browser/device derived from `userAgent`, `ipAddress`, signed in at, `expiresAt`, `This device` badge). Buttons `Log out other devices`, `Log out everywhere`.

### 6.14 Help Center `/help`

Static docs inside the shell: a left sub-nav of topics (Getting started · Selling · Products & stock · Customers & debts · Reports · Team & roles · Account & security), article pages in the reading layout (serif H1, sans body, mono for any codes), a search box at the top. Content is written later; design one article page and the index.

---

## 7. Shared components

| Component | Where | Notes |
|---|---|---|
| **StatCard** | Overview, Reports | mono uppercase label · mono value · sparkline · muted footer with delta |
| **SectionStrip** | any grouped block | mono uppercase title · info tooltip · right slot (`…` menu, segmented control) |
| **DotMatrixBarChart** | Overview, Reports | squares-on-dotted-grid; 1–2 series; tooltip; segmented granularity |
| **DataTable** | every list | mono headers, sortable, sticky header, row hover, checkbox column optional, pagination footer (`page`, `limit` 25/50/100, `total`) |
| **StatusPill** | everywhere | see §8.3 vocabulary |
| **Money** | everywhere | mono, 2 dp, main currency code; optional secondary line in exchange currency |
| **PeriodBar** | Reports | segmented + custom range |
| **ImagePicker** | product, project, announcement, logo | dialog: **Upload** (drag/drop, jpeg/png/webp — HEIC refused) and **Your recent uploads** (`GET /uploads?attached=false`, max 5 pending, with delete); shows `STORAGE_NOT_CONFIGURED` as a calm empty state |
| **CustomerPicker** | counter, debt form, project form | search + `Create new` inline sheet |
| **ProductSearch / BarcodeInput** | counter | scanner-friendly: auto-focus, Enter submits |
| **CurrencyToggle** | counter, payment dialog | `USD` \| `KES` segmented, rate shown muted |
| **ReasonDialog** | void sale, void payment, write-off, stock adjustment | title, explanation of consequence, required `reason` textarea, destructive confirm |
| **EmptyState** | every list | serif title, one line, one CTA; illustration is optional and must be quiet |
| **PermissionGate** | logic | renders nothing when the permission is missing |
| **UnverifiedEmailStrip** | shell | `warning` strip with resend |

---

## 8. Data-display rules

### 8.1 Money and numbers
- Always mono. Two decimals, thousands separator, currency **code** not symbol (`USD 1,250.00`) — the market uses several currencies whose symbols collide.
- A tendered-in-exchange amount shows both lines: `KES 5,000` and muted `≈ USD 38.46 @ 130`.
- Quantities show up to 3 dp trimmed (`2`, `1.5`, `0.250`) followed by the `unit` (`kg`, `pcs`).
- Never show a negative balance; the backend never produces one.

### 8.2 Dates
- In tables: `07 Sep 2026` and `14:32` (mono). Relative time (`2 h ago`) only in feeds (announcements, updates).
- Everything is in the **business timezone**, and the Overview greeting shows that date.
- Due dates cannot be in the past — the picker disables past days.

### 8.3 Status vocabulary (exact words, exact colours)

| Domain | Values | Colour |
|---|---|---|
| Sale payment | `Paid` · `Partial` · `Credit` | success · warning · info |
| Sale status | `Completed` · `Voided` | none · muted + strikethrough total |
| Debt | `Open` · `Overdue` · `Paid` · `Written off` · `Cancelled` | none · danger · success · muted · muted outline |
| Payment | `Completed` · `Voided` | none · muted strikethrough |
| Stock | `In stock` · `Low` · `Out` · `Untracked` | none · warning · danger · muted |
| Movement | `Sale` · `Sale void` · `Restock` · `Adjustment` | muted · info · success · warning |
| Project | `Planned` · `In progress` · `On hold` · `Completed` · `Cancelled` | info · accent · warning · success · muted |
| Member | `Active` · `Invited` | none · warning |
| Import row | `Ready` · `Needs attention` · `Conflict` · `Skipped` | success · warning · danger · muted |
| Import job | `Reviewing` · `Committed` · `Cancelled` | warning · success · muted |
| Customer / product | `Active` · `Archived` | none · muted |

### 8.4 States every screen needs
- **Loading**: skeletons in the shape of the content (cards, rows), never a spinner in the page body.
- **Empty**: EmptyState with one CTA; lists that are empty *because of a filter* say so and offer `Clear filters`.
- **Error**: an inline card with the human message and a tiny mono `Request ID: …` line (the `X-Request-Id` header) — support asks for it.
- **Forbidden (403)**: should never be reached by navigation because items are hidden; if it is, a calm full-page “You don’t have access to this” with a link back.
- **Validation (422)**: field-level messages from `errors`, plus a banner only when no field matches.
- **Conflict (409)**: the specific domain message inline where the action was taken (`INSUFFICIENT_STOCK` on the cart line, `CATEGORY_IN_USE` on the category row, `UPLOAD_PENDING_LIMIT` in the picker, `DEBT_HAS_PAYMENTS` on the void button, `IMPORT_NOT_READY` on the commit button).

---

## 9. Copy and tone

- Plain, short, second person. `Record payment`, not `Submit payment transaction`.
- Titles are nouns (`Debts`), buttons are verbs (`New sale`, `Write off`, `Publish`).
- Money words are exact: *void* (sale, payment), *write off* (debt), *cancelled* (debt from a voided sale), *archive* (customer, product). Never “delete” for anything financial.
- Destructive dialogs state the consequence in one sentence before the reason field: “Stock will be returned for tracked items and the customer’s debt will be cancelled.”
- The greeting is warm but not cute: `Good morning, Amina.` No exclamation marks in the UI.

---

## 10. Deliverables (in priority order)

Produce light **and** dark for 1–5; light only is acceptable for the rest in a first pass. Desktop 1440 wide; tablet 1024 for the counter; mobile 390 for login, overview and the sales list.

1. **Foundations** — tokens sheet (colours, type scale, radii), icon set, the four status pill families, StatCard, SectionStrip, DotMatrixBarChart, DataTable, EmptyState.
2. **Shell** — sidebar (expanded, rail, drawer) with all three role variants, top bar, unverified strip, avatar menu, org menu.
3. **Auth** — login, 2FA, register + “check your email”, forgot/reset, accept invite, onboarding (3 steps).
4. **Overview** — Manager variant, Seller variant, first-steps empty variant.
5. **Counter** — new sale (desktop + tablet), cart states (empty, credit expanded, insufficient stock), receipt, void dialog.
6. **Products** — list, low-stock tab, product detail with stock card and movements, product form, categories tab, import stepper (4 steps + conflict row).
7. **Debts** — list with tabs, debt detail, record-payment dialog, write-off dialog, new manual debt sheet.
8. **Customers** — list, detail with tabs, quick-create sheet.
9. **Reports** — the five sub-pages with the period bar and the reserved Highlights card.
10. **Members & Roles** — members table, invite dialog, roles list, role editor matrix.
11. **Settings & Account** — business, currency, profile, security (2FA setup flow, passkeys), sessions.
12. **Projects & Announcements** — project grid, project detail with share card, public project page, announcement list/detail/form.
13. **Help Center** — index and one article.

---

## Appendix A — Error codes the UI branches on

These are the codes the backend actually emits (branch on `code`, never on `message`).

| Where it surfaces | Codes |
|---|---|
| Any form | `VALIDATION_ERROR` (422, has `errors: { field: message }`) |
| Auth | `UNAUTHORIZED` (wrong credentials or expired session), `EMAIL_NOT_VERIFIED`, `TOO_MANY_REQUESTS` (429), `CREDENTIALS_MISSING` (account has no password) |
| Access | `FORBIDDEN` (403), `NOT_FOUND` (404 — also what another business’s ids return) |
| Products | `DUPLICATE_BARCODE`, `PRODUCT_ARCHIVED`, `STOCK_NOT_TRACKED`, `INSUFFICIENT_STOCK` |
| Categories | `CATEGORY_EXISTS`, `CATEGORY_IN_USE`, `CATEGORY_PROTECTED`, `CATEGORY_NOT_FOUND` |
| Customers | `DUPLICATE_PHONE`, `CUSTOMER_ARCHIVED`, `CUSTOMER_HAS_OPEN_DEBT` |
| Sales | `SALE_ALREADY_VOIDED`, `DEBT_HAS_PAYMENTS` |
| Debts & payments | `DEBT_NOT_OPEN`, `DEBT_WRITTEN_OFF`, `PAYMENT_EXCEEDS_BALANCE`, `PAYMENT_ALREADY_VOIDED` |
| Projects | `ALREADY_PUBLISHED` |
| Uploads | `STORAGE_NOT_CONFIGURED` (503), `UNSUPPORTED_IMAGE`, `IMAGE_TOO_LARGE`, `UPLOAD_PENDING_LIMIT`, `UPLOAD_ATTACHED`, `UPLOAD_PURPOSE_MISMATCH` |
| Import | `IMPORT_UNSUPPORTED_FORMAT`, `IMPORT_FILE_TOO_LARGE`, `IMPORT_TOO_MANY_ROWS`, `IMPORT_NO_ROWS`, `IMPORT_UNKNOWN_HEADER`, `IMPORT_NOT_REVIEWING`, `IMPORT_ROW_NOT_FOUND`, `IMPORT_ROW_NOT_CONFLICT`, `IMPORT_CONFLICT_CHANGED`, `IMPORT_NOT_READY` |

## Appendix B — Things deliberately not designed

Billing/subscriptions · OAuth buttons · notifications bell · AI report text (slot reserved only) · exports (button shown disabled) · expenses · audit log · organization deletion · ownership transfer · multi-organization switching (the org block’s chevron opens Settings/Log out, not a switcher) · photos on project updates.
