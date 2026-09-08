# Task 8 — shell parity with the canvas

## `getInitials("")` returned `"?"`, and the characterization test says it must return `""`

**What:** the plan's Step 1 test is billed as passing on the first run. Five of its six cases did.
`expect(getInitials("")).toBe("")` failed — the implementation returned a literal `"?"`.

**Evidence:** `bunx vitest run components/layout/nav-utils.test.ts` before the fix:
`AssertionError: expected '?' to be ''`, at `nav-utils.test.ts:41`. The old line was
`if (words.length === 0) return "?";` in `components/layout/nav-utils.ts`.

**So what:** the plan says fix the implementation, not the test, so `getInitials` now returns `""`.
Nothing regressed visually: both call sites substitute a real name *before* calling
(`OrgMenu` → `"Your business"`, `UserMenu` → `"Account"`), so the empty branch is only reachable
when the session itself is empty, and a lone `?` in an avatar reads as an error rather than as
loading. If a future caller passes a raw API name straight through, it must supply its own
fallback — this function no longer invents one.

## `rounded-lg` is 10px in this repo, so the canvas's 8px rows need `rounded-md`

**What:** the plan's Step 3 asks for nav items and the org mark at `rounded-lg`. The canvas draws
both at `border-radius:8px`. `rounded-lg` resolves to `var(--radius)` = `0.625rem` = **10px** here;
`rounded-md` is `calc(var(--radius) * 0.8)` = 8px.

**Evidence:** `app/globals.css` — `--radius: 0.625rem;` and the `@theme inline` block's
`--radius-md: calc(var(--radius) * 0.8); --radius-lg: var(--radius);`. Canvas
`docs/design/TradeOs-UI.dc.html:1932` (nav item), `:1921` (org mark), against `:1920` (the org
*box*, which really is `border-radius:10px`).

**So what:** everything drawn at 8px in the canvas is `rounded-md` in this codebase and everything
at 10px is `rounded-lg`. Deviation from the plan's wording, taken deliberately, because the canvas
is the pixel spec. The same trap applies to `rounded-sm` (6px) and `rounded-xl` (14px) — check the
scale before translating a canvas radius by name.

## Three canvas colours the current tokens cannot reproduce

**What:** the shell needs three tones that `app/globals.css` either lacks or defines differently.

| Canvas | Where | Token situation |
|---|---|---|
| `#E8DCBC` | unverified strip's bottom border (`:2110`) | **no token at all** |
| `#565349` | breadcrumb chevron, **dark** (`:2404`) | `--border-strong` dark is `#3A3833` — far darker |
| `#75736D` / `#A19F98` | search glass, placeholder and `⌘K` chip, **dark** (`:2410`) | the canvas uses `--muted-2` in dark where it uses `--muted-3` in light; the tokens do not swap |

**Evidence:** compare `docs/design/TradeOs-UI.dc.html:2110` and `:2404-2412` (dark artboard `1d`)
with the `.dark` block of `app/globals.css`, where `--border-strong: oklch(0.341 0.009 88.74)`
(`#3A3833`, the same value as `--surface-3` and `--border`) and `--muted-3` is `#A19F98`.

**So what:** three consequences, none of which I could fix — `app/globals.css` is Task 1's file.

1. The strip's border is `border-warning/20`, i.e. the warning hue at 20% composited over
   `--warning-soft`. That lands at roughly `#E9D8B4` against the canvas's `#E8DCBC` (an 8/255 gap
   in blue alone) and, unlike a literal hex, still reads in the dark theme.
2. **The breadcrumb chevron is close to invisible in dark mode.** It is `text-border-strong` as the
   plan specifies, which is exact in light (`#C9C7BE`) and `#3A3833` in dark, against a `#262421`
   topbar. `--border-strong` wants its own dark value near `#565349` — it is currently a copy of
   `--surface-3`. Worth one line in `globals.css`.
3. The dark search placeholder and `⌘K` chip are one step brighter than the canvas draws them,
   because the plan pins them to `--muted-3`. Following the canvas literally would mean
   `text-muted-3 dark:text-muted-2`, which is a lie about what those two tokens mean; the honest
   fix is to give the dark ramp its own values.

## The canvas breadcrumb has a "Dashboard" root that no path segment produces

**What:** artboards `1c` and `1d` both draw `Dashboard › Overview` in the topbar. `/overview` is a
single segment, so `buildBreadcrumbs` produces exactly one crumb, `Overview`.

**Evidence:** `docs/design/TradeOs-UI.dc.html:2099-2102` and `:2403-2406`. Every *other* artboard's
breadcrumb maps one-to-one onto path segments — `2a` at `:225` is `Sales › New sale`, which is what
`buildBreadcrumbs("/sales/new")` already returns.

**So what:** not implemented. "Dashboard" is a section label with no route behind it, so producing
it means either a hardcoded root crumb on `/overview` only, or a section table in `config/routes.ts`
— both are decisions the plan does not make and the Overview page is another task's file. The
topbar renders one crumb on `/overview` today. Flagging it for the visual pass.

## `buildBreadcrumbs` still labels every route added since it was written — audited, no gaps

**What:** the task asked specifically. Yes. Every static path in `ROUTES` that renders inside the
shell resolves to a real label; nothing falls through to `humanizeSegment`'s `"Detail"`.

**Evidence:** a throwaway audit that ran `buildBreadcrumbs` over every string value of `ROUTES`
(added to `nav-utils.test.ts`, run, reverted). All 20 shell paths were named:
`/team → Members`, `/team/roles → Members › Roles`, `/products/import → Products › Import`,
`/reports/staff → Reports › Staff`, `/account → Account`, `/help → Help Center`, and so on. The
only unlabelled hit was `/login/2fa → Login › Detail`, and `(auth)` pages render no breadcrumb at
all.

**So what:** nothing to do now. The routes Tasks 5–7 added are all outside the shell, which is why
the tables did not need touching. A shell route added later still has to be added to `NAV_LABELS`
(via `NAV_GROUPS`) or to `SUB_PAGE_LABELS`, or it silently renders as `"Detail"`.

## What the canvas leaves ambiguous about the rail and the drawer

**What:** artboard `1b` draws four sidebars. Two of them are incomplete as *interfaces*, not just as
sketches, and I filled the gaps rather than reproducing them.

- **Rail (`:2010`)** — has the 32px org mark, eleven icons, a spacer and the avatar. It shows **no
  Help Center label, no collapse control and no rule above the footer**. But the manager's icon
  count is 11, which is 10 nav items *plus* Help Center, so Help Center is in there; it is only the
  label that the rail cannot show. There is no drawn way to get *out* of the rail.
- **Drawer (`:2025`)** — has a header and a nav list and then simply stops. **No Help Center, no
  user row, no way to sign out**, and it is the only navigation surface below 1024px.

**Evidence:** `docs/design/TradeOs-UI.dc.html:2010-2022` (rail, ends at the avatar) and
`:2025-2048` (drawer, the last element is the nav `<div>`).

**So what:** the rail keeps Help Center (as an icon with its tooltip), the collapse toggle and the
footer rule — a rail you cannot leave is a trap, and the toggle is the only affordance that
expands it. The drawer keeps the whole footer including `UserMenu`, because on a phone it is the
only route to Log out. Neither addition contradicts the canvas; both are things it did not draw.
If the owner wants the drawer's footer gone, sign-out needs a home somewhere else first.

## `SheetContent`'s own `data-[side]` classes outrank any width you pass it

**What:** the mobile drawer was never 288px. `components/ui/sheet.tsx` sets
`data-[side=left]:w-3/4`, which compiles to `.data-\[side\=left\]\:w-3\/4[data-side="left"]` —
specificity (0,2,0). A `w-72` in `className` is (0,1,0) and loses, and `cn` cannot dedupe them
because the modifiers differ, so both survive into the DOM. The drawer rendered at 75% of the
viewport.

**Evidence:** compiled the two utilities with Tailwind's own `compile()` API:
`.w-72 { width: … }` versus `.data-\[side\=left\]\:w-3\/4[data-side="left"] { width: calc(3/4 * 100%) }`.
Pre-existing — the foundation's `w-[17rem]` had the identical problem, which is why the drawer
"looked about right" on a 390px phone (75% ≈ 292px) and wrong on anything wider.

**So what:** `mobile-nav.tsx` now uses `w-72!`. Any caller overriding a `SheetContent` dimension
needs the `!` suffix or a matching `data-[side=…]:` prefix; the same trap exists for
`data-[side=left]:h-full`, `:border-r` and `:sm:max-w-sm`. Related and *not* fixed: the canvas
scrim is `rgba(31,30,29,0.45)` (`:2028`) and `SheetOverlay` hardcodes `bg-black/10`. The overlay is
internal to `sheet.tsx` and takes nothing from the caller, so the drawer's backdrop is much lighter
than drawn. `components/ui/` is vendored shadcn and out of bounds for this task.

## `ThemeToggle` takes no `className`, so both frames style it through a wrapper

**What:** the canvas draws the topbar toggle as a 34px bordered square on `--card` with a 10px
radius (`:2109`); `ThemeToggle` renders a borderless 28px ghost button and accepts no props.

**Evidence:** `components/shared/theme-toggle.tsx` — `export function ThemeToggle()`, no parameters.
`app/(auth)/layout.tsx` already worked around this with `*:size-8 *:rounded-[9px] *:border …`.

**So what:** the topbar uses the same `*:` wrapper for consistency. I checked that it actually wins
rather than tying: Tailwind emits `:is(.\*\:size-8 > *)` — specificity (0,1,0), the same as
`.size-7` — but *after* the plain utility in the stylesheet, so the wrapper does take effect. It is
still a workaround in two places now. Giving `ThemeToggle` a `className` prop (one line, plus `cn`)
would delete both.

## The canvas's "Seller · 7 items" counts grouped nav rows only, and it is right

**What:** the caption looks inconsistent with the rail's `hint-placeholder-count="11"` for the
manager, and it is worth writing down that both are correct so nobody "fixes" the nav to match.

**Evidence:** `PRESET_SELLER` (`lib/auth/permissions.ts:114`) holds `projects:view` and
`announcements:view`, so a Seller keeps Overview, Sales, Products, Customers, Debts, Announcements
and Projects = **7 grouped rows**, and loses exactly Reports, Members and Settings — the three the
caption names. The manager's 10 grouped rows plus Help Center is the rail's **11**. The seller
count excludes Help Center; the rail count includes it.

**So what:** no change needed. The `hidden … has-[a]:flex` trick on the group wrapper already drops
the whole "Manage" heading for a Seller, since both of its items hide themselves.
