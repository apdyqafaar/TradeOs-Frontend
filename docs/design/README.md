# The design canvas

`TradeOs-UI.dc.html` is a decoded copy of the Claude Design canvas
`TradeOs UI.dc.html`, pulled 2026-09-07 from project
`f6b9001a-32da-4afe-831a-7c1ce4bd045d` ("TradeOs frontend design", owner Abdiqafaar).

**It is a reference, not a build input.** Nothing imports it. Read it to get exact colours,
spacing, type sizes and component structure while implementing a screen, then write idiomatic
React against the tokens in `app/globals.css`.

## How to read it

Each artboard is a `<div id="…">` holding one screen or component group. Open the file at the line
below and read to the next id.

| id | Line | What it shows |
|---|---|---|
| `1a` | 1734 | **Foundations** — light/dark surface tokens, type scale, status pills, StatCard, SectionStrip, BarChart, DataTable, EmptyState |
| `1b` | 1908 | **Shell** — sidebar for manager and seller, collapsed rail, mobile drawer |
| `1c` | 2050 | **Overview** — manager, light, 1440, unverified-email strip shown |
| `1d` | 2353 | **Overview** — manager, dark, email verified |
| `1e` | 2563 | **Overview** — seller variant, and the brand-new-business "First steps" state |
| `1f` | 2661 | **Auth** — login light, login dark with error, 2FA code entry |
| `2a` | 217 | **New sale** — touch density, credit expanded, insufficient stock on a line |
| `2b` | 370 | **Receipt** — void dialog, voided state |
| `2c` | 489 | **Products** — list with tabs |
| `2d` | 566 | **Product detail** — stock card, movements, restock dialog |
| `2e` | 708 | **Import** — upload, map columns, review rows, commit |
| `2f` | 816 | **Debts** — list with status tabs |
| `2g` | 874 | **Debt detail** — payments timeline, record payment, write off |
| `2h` | 984 | **Customers** — list, detail with debt summary, quick-create sheet |
| `2i` | 1081 | **Reports** — sales, products, debts ageing, period bar, reserved Highlights card |
| `2j` | 1206 | **Members** — invite dialog, roles list, permission matrix |
| `2k` | 1323 | **Settings** — business & currency; **Account** — security, sessions |
| `2l` | 1492 | **Projects** — grid, detail with share card, public client page |
| `2m` | 1647 | **Announcements** — list, reading layout, form sheet; **Help Center** |
| `3a` | 30 | **Alerts** — toast families, loading, undo, stack, placement, dark |

## Two things the file does not tell you

1. **`<sc-for list="{{ navLight }}">` and friends are canvas repeat placeholders.** The data is
   supplied by the editor, not stored here, so nav labels, table rows and chart bars are absent.
   Take navigation from `config/routes.ts` and row shapes from the API.
2. **`{{ icoPlus }}`, `{{ icoDown }}` … are icon slots**, rendered as CSS masks. Use the
   equivalent lucide icon; the sizes beside them (14/15/16/18px) are real and worth keeping.

## Screens not in the canvas

Register, forgot password, reset password, accept invite, and the three-step onboarding are **not
designed**. Build them from the design brief in the conventions artboard `1f` establishes — 520×660
frame, 400px column, 36px Instrument Serif headline, 44px fields, 10px radius.
