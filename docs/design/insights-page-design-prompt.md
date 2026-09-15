# Design prompt — the TradeOs Insights page

*Paste everything below into your design agent. It is self-contained; the agent does not
need repository access.*

---

## What you are designing

One screen: **`/insights`** in TradeOs, a web app used by small trading shops in Somalia and
Ethiopia — general stores, wholesalers, electronics kiosks. Every evening, five AI analysts
read that shop's own day (sales, debts owed to the shop, stock, staff and projects) and write a
short digest. This screen is where the owner reads it.

**Who is looking at it.** A shop owner, around 9pm, who has spent the whole day serving
customers. Often on a phone, often on a slow connection. She is not going to read an essay.
She wants to know, in about five seconds: *did today go well, and what do I have to do
tomorrow?* Anything she has to work for, she will stop opening.

**What is wrong with it now.** The page is a stack of prose cards — paragraphs of AI-written
text under headings. There is not a single number, chart or shape on it. The owner's words:
*"the way we are showing the user is not professional — let us make what a user can understand
quickly, pretty, meaningful and modern."*

---

## The design system you must work inside — do not invent one

This app already has a design language, drawn on a canvas and built. **Your job is to compose
with it, not to replace it.** A screen that looks like a different product is a failed design
here, however good it looks alone.

### Colour — warm, paper-like. Never pure white, never pure black.

**Light**
| Role | Hex |
|---|---|
| Page background | `#F5F4EE` |
| Card surface | `#FBFAF7` |
| Raised / inset fill | `#F0EEE6` |
| Text | `#1F1E1D` |
| Muted text | `#6E6D68` |
| Subtle text | `#A9A7A0` |
| Hairline border | `#E3E1D8` |
| **Accent (terracotta)** | `#D97757` |

**Dark**
| Role | Hex |
|---|---|
| Page background | `#1C1B19` |
| Card surface | `#262421` |
| Raised fill | `#2F2D29` |
| Text | `#EDEBE5` |
| Muted text | `#A19F98` |
| Subtle text | `#75736D` |
| Hairline border | `#3A3833` |
| **Accent** | `#E08A6B` |

**Status colours** exist for good / warning / bad, each with a soft tinted variant for
backgrounds. **The accent is the only saturated colour on the page** apart from status pills
and chart series. Design both themes — dark is genuinely used.

### Type — three faces, each with one job

| Face | Use |
|---|---|
| **Instrument Serif** (regular 400 only) | Display headings and AI prose. Nothing else. |
| **Geist** (sans) | Navigation, body, forms, buttons, words in tables |
| **Geist Mono** | **Every number and money value**, uppercase card labels, table headers, dates in tables, axis labels |

The sizes this app already uses — stay on this scale:

- Page title — serif **32px / line-height 1.1**
- Section or detail title — serif **26px / 1.1**
- AI prose — serif **20px / 1.35**, `text-wrap: pretty`, max width **720px**
- Card label — mono **10–11px**, UPPERCASE, letter-spacing **+0.08em**, muted
- Body — **13px** sans
- Caption — **12px**
- Big number — mono **26–32px**, weight 500

### Shape

Radius **10px** for cards and inputs, **8px** for pills and chips, **14px** for dialogs.
**No drop shadows on cards** — a hairline border and one step of surface change do all the
lifting. Icons: lucide, 16px inline, 18px in navigation, 1.5px stroke.

### Components already designed — reuse these shapes

- **StatCard** — uppercase mono label (`TOTAL REVENUE`), a large mono number (`USD 20,320.00`),
  a small sparkline of thin bars on the right in accent with the last bar at full opacity, and
  a footer row: info icon · `+0.94% last year` with the delta in green.
- **Bar chart** — solid bars with a rounded top (`6px 6px 0 0`, max width 56px) on a four-line
  horizontal grid, mono uppercase axis labels, accent for the single series.
- **Section strip** — an uppercase mono title with an info icon, actions at the right.
- **Highlights card** — the panel this very feature was reserved: `10px` radius, `20px`
  padding, a mono `10px` uppercase label, serif `20px / 1.35` prose, 720px max width.
- **Empty state** — serif title, one muted line, optional action.

---

## The content you are arranging

A digest has five sections. Each is written by a different analyst and **any of them can be
missing**.

1. **Sales** — headline · up to 5 points · a comparison against last week and month-to-date · anomalies
2. **Debts** (money customers owe the shop) — headline · points · *accounts to chase*: customer name + why
3. **Stock** — headline · points · *reorder*: product name + why
4. **Team & projects** — headline · what people did · project movement
5. **What to do tomorrow** — up to 6 actions, each with a **priority** (high / medium / low) and a **kind** (chase · restock · review · promote · project)

**We are adding structured numbers to every section**, specifically so this screen can draw
rather than only write. Design for these — they are the material for your stat cards and charts:

```
figures: up to 4 per section
  { label: "Revenue", value: 20320, unit: "money" | "count" | "percent",
    direction: "up" | "down" | "flat", deltaPct: 0.94 }

series: up to 12 points, optional
  { label: "Mon", value: 4200 }
```

**Money is formatted with the currency CODE, never a symbol** — `USD 20,320.00`, `KES 1,250.00`
— because this market mixes currencies whose symbols collide. Numbers use tabular figures.

---

## The states you must design — not just the happy one

This is where the current page fails hardest, so treat these as first-class, not edge cases:

1. **Complete** — all five sections written.
2. **Partial** — the run stopped early; **some sections exist and others do not.** This is
   common. The sections that did arrive are exactly as true as on a complete run, and the page
   must say which are missing without making the whole digest feel broken or apologetic.
3. **Failed** — nothing was written. Say so plainly. Do not show five empty frames.
4. **No digest yet** — the feature is on, tonight's has not run. Say when it will arrive.
5. **Switched off** — the AI digest is disabled for this shop. Explain, and link to settings.
6. **Generating** — a manual run is in progress, taking up to about a minute.

Also design the **period control**: the owner can generate a digest for *today · last 7 days ·
last 30 days · last 90 days · this year · a custom range*, and a "Generate now" action beside
it, limited to three a day.

And a small **history** list of earlier digests, each opening its own page.

---

## What good looks like

- **The numbers land before the prose.** She should get the shape of the day from figures and a
  chart before reading a sentence. Today the page opens with paragraphs; that is backwards.
- **Scannable in five seconds, readable in sixty.** A glance answers "good day or bad day?".
  Reading answers "why, and what now?".
- **Tomorrow's actions are the most valuable thing on the page** — that is the part that changes
  what she does. Priority must be visible **in the text**, not by colour alone.
- **Mobile is not an afterthought.** Many owners only ever see this on a phone. Design the
  narrow layout deliberately.
- **Calm, not a dashboard.** This is an evening read, not a control room. Warm paper, generous
  space, one accent. Resist filling every corner with a widget.

## What to avoid

- Do not invent new colours, faces or radii. Everything above already exists.
- No drop shadows on cards.
- No emoji as section markers, no gradient heroes, no purple-to-blue anything.
- Do not make every block a card of identical weight — that flattens the hierarchy. Decide what
  matters most and let it be biggest.
- Do not hide the missing sections to make the page look tidier. Honesty about what the
  analysts did not finish is a feature of this product.
- Do not put a chart on the page just because charts look modern. Draw something only where the
  shape of the data actually tells the owner something.

## Deliver

A design for `/insights` in **light and dark**, at **desktop (1280px content) and phone
(390px)**, covering states 1–4 above, plus the period control and the history list. Annotate
the type sizes and spacing you use so it can be built exactly.
