# Task 2 — the auth frame and the login form

## Next 16 allows exactly one dev server per project directory, whatever the port

**What:** `bunx next dev -p 3100` does not give you a private server alongside another agent's
`bun run dev`. Next binds the port, prints "Ready", and *then* exits 1 with "Another next dev server
is already running… PID 8708 … Dir: C:\Users\Aa\Desktop\TradeOs\Frontend". The lock is on the
project directory (`.next/dev`), not the port, and the only escape it offers is `taskkill` on the
other agent's process.

**Evidence:** the plan's Task 2 Step 7 and this task's brief both say to run on a private port;
doing so produced that message and exit code 1. Grepping `node_modules/next/dist` for the string
finds nothing, so the check lives in the Turbopack native binary and there is no JS-level flag to
disable it.

**So what:** parallel agents cannot each hold a dev server. Either the lead runs one server that
everyone views, or an agent that needs its own uses a git worktree (a different directory, hence a
different lock). I verified `/login` against the server already running on :3000 — same working
tree, read-only navigation, nothing killed.

## Screenshots without the Chrome extension: headless Edge, and the flag that forces light mode

**What:** `mcp__claude-in-chrome__*` reported "Browser extension is not connected", and the machine
has no Chrome — only `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Edge headless
takes screenshots fine. It defaults to `prefers-color-scheme: dark` here, so with
`ThemeProvider defaultTheme="system"` the *default* capture is the dark artboard, not the light one.

**Evidence:**

```
msedge.exe --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
  --window-size=1440,900 [--blink-settings=preferredColorScheme=1] \
  --screenshot=out.png http://localhost:3000/login
```

`preferredColorScheme=1` renders the light palette; omitting the flag renders dark.

**So what:** every later task with a "compare against the canvas in both themes" step can do it this
way. Do not conclude a page is broken because the first capture came back dark.

## `cn` drops `leading-none` when you override a `text-*` size

**What:** `<Label className="text-[13px]">` does not just replace `text-sm` — the rendered class
list loses `leading-none` too. tailwind-merge (which the `cn` package implements) declares
`font-size` as conflicting with `leading`, because a Tailwind v4 `text-sm` sets both.

**Evidence:** `curl localhost:3000/login` renders the label as
`class="flex items-center gap-2 font-medium select-none … text-[13px]"` — `text-sm` *and*
`leading-none` are both gone, from a source that only overrode the size.

**So what:** any component whose base classes pair a size with a leading (`Label`, `Button` sizes)
silently loses the leading when you resize it. If you need the tight line box back, pass
`leading-none` explicitly alongside your size. Here the looser line box is what the canvas draws, so
it was left alone — but it is not what the class list says.

## `useSearchParams` needs a Suspense boundary or `/login` cannot be prerendered

**What:** `LoginForm` reads `?next=` through `useSearchParams()`. On a statically prerendered page
that forces a client-side bailout, which Next treats as a build error unless the component sits
behind `<Suspense>`.

**Evidence:** `app/(auth)/login/page.tsx` wraps `<LoginForm />` in a boundary; the served HTML shows
the `<!--$-->` marker with the form rendered inside it.

**So what:** every later auth page that reads a query parameter — verify-email, reset-password and
accept-invite all take a `?token=` — needs the same boundary. The fallback should reserve the
child's height (338px here) or the centred column jumps.

## `ThemeToggle` takes no `className`, and Task 8 will hit the same wall

**What:** artboard `1f` draws a 32px `rounded-[9px]` bordered square for the theme toggle, but
`components/shared/theme-toggle.tsx` renders a fixed `<Button variant="ghost" size="icon-sm">` (28px,
`rounded-lg`, no border) and accepts no props at all. It was outside this task's file list, so the
auth frame restyles it from the parent with child variants:
`*:size-8 *:rounded-[9px] *:border *:border-border *:bg-card`.

**Evidence:** `app/(auth)/layout.tsx`. It works because Tailwind emits `:is(.\*\:size-8 > *)` at
line 2150 of the stylesheet, after plain `.size-7` at line 866 — same specificity, later wins. That
ordering is an implementation detail, not a guarantee.

**So what:** artboard `1c` wants a *34px* square toggle in the topbar, so Task 8 needs a third size.
Give `ThemeToggle` a `className` prop and delete the child-variant workaround in the auth layout
rather than adding a second wrapper hack.

## `title="Coming soon"` on the disabled passkey button never actually shows

**What:** the plan asks for the passkey button rendered `disabled` with `title="Coming soon"`. The
button variant carries `disabled:pointer-events-none`, so the element receives no hover events and
the native tooltip never appears. The attribute is in the DOM and does nothing.

**Evidence:** `components/ui/button.tsx` base classes; `features/auth/components/login-form.tsx`
renders both as specified.

**So what:** left as the plan specifies — it is harmless and the intent is documented in the DOM.
When passkeys are actually built, if the disabled state needs to explain itself to a mouse user it
has to be `aria-disabled` plus a real tooltip, not `disabled` plus `title`.

## Base UI's `Button` does honour `type="submit"` despite defaulting to `type: "button"`

**What:** `useButton` merges `{ type: 'button' }` into the props it returns, which reads like it
would stop a submit button from submitting. It does not — `useRenderElement` lets the caller's
`elementProps` win.

**Evidence:** the second case in `features/auth/components/login-form.test.tsx` clicks
`Continue` and asserts `mutate` was called; it passes.

**So what:** no `onClick={handleSubmit(...)}` workaround is needed on any form in this codebase.
Plain `<Button type="submit">` inside a `<form onSubmit>` is enough.

## Decisions the plan was silent on

**What:** three small choices, recorded so they are not read as accidents.

1. The email input is `autoFocus`. The canvas draws the focus ring on the password field, but that
   is the canvas illustrating what a focus ring looks like, not an instruction about tab order.
2. The banner suppresses itself when the error carries `fieldErrors`, so a 422 shows on the inputs
   only and the user does not read the same complaint twice.
3. The banner's message text inherits `text-foreground`. Artboard `1f` dark tints it `#EDCCC6`;
   there is no light-mode reference and no token for that tone, and the plan's spec for
   `auth-error-banner.tsx` colours only the icon.

**Evidence:** `features/auth/components/login-form.tsx`, `auth-error-banner.tsx`.

**So what:** if a later screen wants the tinted message text, add it to both themes at once — the
obvious candidate, `--destructive-strong`, is `#8E2C21` in light and does not lift to `#EDCCC6` in
dark, so it is not the token the canvas used.
