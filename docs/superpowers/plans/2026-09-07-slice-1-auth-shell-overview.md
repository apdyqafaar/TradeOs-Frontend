# Slice 1 — Auth, Shell and Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TradeOs usable end to end for a real person — register, verify, create a business, sign in, and land on a working Overview dashboard inside the designed shell.

**Architecture:** Every screen is a thin Server Component page under a route group, rendering client components that call feature hooks. Hooks own React Query; services own axios; the interceptor owns the envelope. Auth's service layer already exists and is not rewritten — this slice adds the missing hooks, the pages, the `organization` and `dashboard` feature slices, and brings the shell to pixel parity with the design canvas.

**Tech Stack:** Next.js 16 (App Router, React Compiler), React 19, TanStack Query v5, axios, zustand, zod v4, react-hook-form, nuqs, Tailwind v4, shadcn base-nova on `@base-ui/react`, lucide, vitest + Testing Library + happy-dom, Bun.

**Spec:** `docs/superpowers/specs/2026-09-07-frontend-ui-design-brief.md`
**Design canvas:** `docs/design/TradeOs-UI.dc.html` (index and caveats in `docs/design/README.md`)
**API contract:** `docs/API-ROUTES.md` — all 111 endpoints with their exact paths and permission gates, extracted from the backend source. **Every service function must correspond to a row in it.** If a path is not listed, the endpoint does not exist.
**Repo rules:** `CLAUDE.md` — read it before the first task.

---

## Global Constraints

These apply to every task. They are decisions the owner made on 2026-09-07; do not relitigate them in code review.

- **Design fidelity beats WCAG here.** Active nav text is `#D97757` on `#F6E7DF` (2.6:1) and the primary button is `#D97757` with `#FBFAF7` text (3.0:1). The owner chose to match the canvas exactly. Do **not** "fix" the contrast. Task 1 reverts the deepened `#A9502F` that was shipped before this decision.
- **Desktop is spec, smaller is derived.** Match the canvas exactly at a 1440px viewport (240px sidebar, 1200px content region, 32px content padding). Below 1024px follow brief §4's responsive rules, which the canvas does not cover. Keep `max-width: 1280px` on the content wrapper so ultrawide screens do not stretch.
- **Five screens are not designed** — register, forgot password, reset password, accept invite, onboarding. Build them in the conventions artboard `1f` establishes: 400px column, 36px Instrument Serif headline, `#6E6D68` subtitle at 14px, 44px tall fields with 10px radius and `#E3E1D8` border on `#FBFAF7`, 16px gap between fields, 7px gap between label and input, full-width 44px primary button.
- **Never branch on `message`; branch on `code`** from `API_ERROR_CODE`.
- **Never send an organization id.** The API resolves the tenant from the session.
- **Money is `formatMoney(amount, currency)`; dates are `formatDate(iso, timezone)`.** Both arguments always. No hardcoded `"USD"`, no `toLocaleDateString`.
- **Server Components by default.** `"use client"` goes on the smallest component that needs it, never on a `page.tsx` unless the whole page is interactive.
- **No `useMemo`/`useCallback` for referential stability** — the React Compiler is on.
- **Every list and panel handles the six states** from brief §8.4: loading skeleton, empty, filtered-empty, error card with `requestId`, 403, and the relevant 409 domain code inline.
- **Style:** double quotes, semicolons, 2-space indent, `import type` for types. Run `bun run lint:fix` before committing.
- **Definition of done for every task:** `bun run check` passes (typecheck + lint + tests).

---

## File Structure

**Modified**
- `app/globals.css` — token reconciliation (Task 1)
- `app/(auth)/layout.tsx` — exact canvas frame (Task 2)
- `app/(auth)/login/page.tsx` — replace the placeholder (Task 2)
- `app/(app)/layout.tsx`, `components/layout/*` — shell parity (Task 8)
- `app/(app)/overview/page.tsx` — replace the placeholder (Task 11)
- `config/routes.ts` — add any route added here
- `proxy.ts` — add new public paths to the guest matcher (Task 5, Task 7)

**Created — auth pages**
- `features/auth/hooks/use-two-factor-challenge.ts`, `use-forgot-password.ts`, `use-reset-password.ts`, `use-accept-invite.ts`, `use-verify-email.ts`, `use-resend-verification.ts`
- `features/auth/components/auth-card.tsx` — the shared 400px column: headline, subtitle, slot, footer link
- `features/auth/components/auth-error-banner.tsx` — the `#C0392B` soft banner from artboard `1f`
- `features/auth/components/login-form.tsx`, `two-factor-form.tsx`, `register-form.tsx`, `forgot-password-form.tsx`, `reset-password-form.tsx`, `accept-invite-form.tsx`, `check-email-panel.tsx`, `code-input.tsx`
- `app/(auth)/login/2fa/page.tsx`, `register/page.tsx`, `verify-email/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `accept-invite/page.tsx`

**Created — organization / onboarding**
- `features/organization/types.ts`, `schemas/organization.schema.ts`, `services/organization.service.ts`, `keys.ts`, `hooks/use-create-organization.ts`, `hooks/use-organization.ts`
- `features/organization/components/onboarding-wizard.tsx`, `step-business.tsx`, `step-currency.tsx`, `step-invite.tsx`
- `app/(auth)/onboarding/page.tsx`

**Created — dashboard**
- `features/dashboard/types.ts`, `keys.ts`, `services/dashboard.service.ts`, `hooks/use-dashboard.ts`
- `features/dashboard/components/` — `stat-card.tsx`, `section-strip.tsx`, `bar-chart.tsx`, `sales-section.tsx`, `my-sales-section.tsx`, `debts-section.tsx`, `stock-section.tsx`, `staff-section.tsx`, `projects-section.tsx`, `announcements-section.tsx`, `team-section.tsx`, `first-steps-card.tsx`, `overview.tsx`

**Created — shared**
- `components/shared/error-card.tsx` — the standard error panel with the request id

---

### Task 1: Reconcile design tokens

Brings `app/globals.css` to the canvas's exact values and locks the owner's contrast decision with a test, so it cannot be silently reverted by a future accessibility pass.

**Files:**
- Modify: `app/globals.css`
- Create: `app/globals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties consumed by every later task — `--primary`, `--primary-soft`, `--primary-soft-foreground`, `--muted-2`, `--muted-3`, `--surface-2`, `--surface-3`, `--border-strong`, and `--{success,warning,info,destructive}-strong`.

- [ ] **Step 1: Write the failing test**

```ts
// app/globals.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** Reads a custom property's value out of the `:root` (light) block. */
const lightToken = (name: string): string | undefined => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
};

describe("design tokens", () => {
  it("uses the canvas terracotta for primary, not a darkened variant", () => {
    // Owner decision 2026-09-07: the design canvas wins over WCAG contrast on
    // the accent. #D97757 on #F6E7DF is 2.6:1 and that is intentional. If this
    // test fails, someone has "fixed" the contrast — ask before changing it.
    expect(lightToken("--primary")).toBe("oklch(0.6724 0.1308 38.76)");
    expect(lightToken("--sidebar-accent-foreground")).toBe(
      "oklch(0.6724 0.1308 38.76)",
    );
  });

  it("defines every token the canvas uses", () => {
    for (const token of [
      "--muted-2",
      "--muted-3",
      "--surface-2",
      "--surface-3",
      "--border-strong",
      "--success-strong",
      "--warning-strong",
      "--info-strong",
      "--destructive-strong",
    ]) {
      expect(lightToken(token), `${token} missing from :root`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run app/globals.test.ts`
Expected: FAIL — `--sidebar-accent-foreground` is currently `oklch(0.5368 0.1262 40.29)` (the `#A9502F` deepened value), and none of the new tokens exist.

- [ ] **Step 3: Update `app/globals.css`**

In `:root`, set `--sidebar-accent-foreground: oklch(0.6724 0.1308 38.76);` — the same value as `--primary`, matching the canvas at `docs/design/TradeOs-UI.dc.html:2102`. Leave the `.dark` value as `oklch(0.7165 0.1144 40.51)` (`#E08A6B`), which the canvas also uses.

Add these to `:root`, converting each canvas hex to oklch:

| Token | Light hex | Where the canvas uses it |
|---|---|---|
| `--muted-2` | `#8A8880` | "Business" label, `or` divider text, `⌘K` chip |
| `--muted-3` | `#A9A7A0` | nav group labels, search placeholder, legal footer |
| `--surface-2` | `#EFEDE5` / `#E8E6DE` | segmented-control track |
| `--surface-3` | `#D8D6CD` | pressed / heavier fills |
| `--border-strong` | `#C9C7BE` | breadcrumb chevrons, stronger rules |
| `--success-strong` | `#3E7049` | text on a success tint |
| `--warning-strong` | `#7A5A1C` | unverified-email strip text |
| `--info-strong` | `#41556E` | annotation text |
| `--destructive-strong` | `#8E2C21` | text on a danger tint |

Mirror all nine in `.dark` using the canvas's dark equivalents (`#75736D` for `--muted-2`, `#A19F98` for `--muted-3`, `#2F2D29` for `--surface-2`, `#3A3833` for `--surface-3`/`--border-strong`; for the four `-strong` tones lift lightness ~0.14 and keep the hue, as the existing dark status tokens do). Expose every new token in the `@theme inline` block as `--color-<name>` so `bg-surface-2` and `text-warning-strong` work.

- [ ] **Step 4: Run the test and the build**

Run: `bunx vitest run app/globals.test.ts && bun run build`
Expected: PASS, and the build compiles the CSS without an unknown-utility error.

- [ ] **Step 5: Record the decision in `CLAUDE.md`**

In the "Open items for the owner" section, replace the primary-button contrast bullet with:

```markdown
- **Contrast: design fidelity wins — decided 2026-09-07.** Active nav (#D97757 on #F6E7DF, 2.6:1)
  and the primary button (3.0:1) are below WCAG AA for small text. The owner chose to match the
  design canvas exactly. `app/globals.test.ts` locks the value; do not change it without asking.
```

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/globals.test.ts CLAUDE.md
git commit -m "style(tokens): match the design canvas exactly, lock the accent"
```

---

### Task 2: The auth frame and the login form

Replaces the two auth placeholders with the real thing. Artboard `1f` (`docs/design/TradeOs-UI.dc.html:2661`) is the spec — read it before writing.

**Files:**
- Modify: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`
- Create: `features/auth/components/auth-card.tsx`, `auth-error-banner.tsx`, `login-form.tsx`
- Test: `features/auth/components/login-form.test.tsx`

**Interfaces:**
- Consumes: `useLogin()` → `UseMutationResult<LoginResult, ApiError, LoginInput>` where `LoginResult` is `{ twoFactorRequired: true; challengeToken: string; expiresAt: string } | { twoFactorRequired: false; user: SessionUser }`; `loginSchema` / `LoginInput`; `fieldErrorsFor`; `API_ERROR_CODE`.
- Produces: `<AuthCard headline subtitle footer>`, `<AuthErrorBanner message />`, `<LoginForm />`.

- [ ] **Step 1: Write the failing test**

```tsx
// features/auth/components/login-form.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  useSearchParams: () => new URLSearchParams(),
}));

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-login", () => ({
  useLogin: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("LoginForm", () => {
  it("refuses to submit an invalid email and never calls the API", async () => {
    render(wrap(<LoginForm />));
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("submits valid credentials", async () => {
    render(wrap(<LoginForm />));
    await userEvent.type(screen.getByLabelText("Email"), "amina@sparktrading.co.ke");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mutate).toHaveBeenCalledWith(
      { email: "amina@sparktrading.co.ke", password: "secret123" },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/auth/components/login-form.test.tsx`
Expected: FAIL — `Cannot find module './login-form'`.

- [ ] **Step 3: Build `AuthCard` and `AuthErrorBanner`**

`auth-card.tsx` is a Server Component (no hooks): a 400px flex column with `gap:22px`, holding a header block (`gap:8px`) whose headline is `font-serif text-[36px] leading-[1.08]` and whose subtitle is `text-sm text-muted-foreground`, then `{children}`, then an optional `footer` node centred at `text-[13px] text-muted-foreground`.

`auth-error-banner.tsx`: `flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3`, background `bg-destructive/12`, border `border-destructive/40`, a 16px `TriangleAlert` at `text-destructive` with `mt-px`, and `text-[13px]` message text. Give it `role="alert"`.

- [ ] **Step 4: Build `login-form.tsx`**

`"use client"`. `useForm<LoginInput>({ resolver: zodResolver(loginSchema) })`. On submit call `mutate(values, { onSuccess })`. In `onSuccess`, branch on the discriminated union:

```tsx
const onSuccess = (result: LoginResult) => {
  if (result.twoFactorRequired) {
    router.push(ROUTES.twoFactor);
    return;
  }
  router.push(searchParams.get("next") ?? ROUTES.overview);
};
```

Map a 422 onto fields with `fieldErrorsFor(error)` and `setError`; render anything else through `<AuthErrorBanner>`, using `"Wrong email or password."` for `API_ERROR_CODE.UNAUTHORIZED` and `"Too many attempts — try again in a few minutes."` for `TOO_MANY_REQUESTS`. Fields use `<Label>` + `<Input className="h-11 rounded-[10px]">`; the password field carries a right-aligned `Forgot password?` link at `text-xs`. Below the button: the `or` divider (two `flex-1 h-px bg-border` rules around `text-xs text-muted-2`), then a full-width outline button `Sign in with a passkey` with a 16px `KeyRound` icon — **render it disabled with `title="Coming soon"`**; passkey login is not wired in this slice.

- [ ] **Step 5: Rewrite `app/(auth)/layout.tsx` and `login/page.tsx`**

Layout: full-height flex centre on `bg-background`, wordmark `TradeOs` absolutely at `top-[22px] left-[26px]`, `text-[15px] font-semibold tracking-[-0.01em]`, theme toggle at `top-5 right-6` in a 32px `rounded-[9px]` bordered button. Page: `export const metadata = { title: "Sign in" }`, renders `<AuthCard headline="Your business, in order." subtitle="Sign in to your TradeOs account." footer={…}><LoginForm /></AuthCard>` plus the two-line legal note at `text-[11px] text-muted-3`.

- [ ] **Step 6: Run the tests**

Run: `bunx vitest run features/auth/components/login-form.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 7: Verify against the design**

Run `bun run dev`, open http://localhost:3000/login in both themes, and compare side by side with artboard `1f`. Check: 36px serif headline, 44px fields, 10px radii, the terracotta focus ring on the focused field, and the `or` divider.

- [ ] **Step 8: Commit**

```bash
git add app/\(auth\) features/auth/components
git commit -m "feat(auth): login form and the shared auth card"
```

---

### Task 3: Two-factor challenge

**Files:**
- Create: `features/auth/hooks/use-two-factor-challenge.ts`, `features/auth/components/code-input.tsx`, `two-factor-form.tsx`, `app/(auth)/login/2fa/page.tsx`
- Test: `features/auth/components/code-input.test.tsx`

**Interfaces:**
- Consumes: `twoFactorChallenge(input)` from the auth service; `twoFactorChallengeSchema`.
- Produces: `<CodeInput length={6} value onChange />`, `useTwoFactorChallenge()`.

- [ ] **Step 1: Write the failing test**

```tsx
// features/auth/components/code-input.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CodeInput } from "./code-input";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <CodeInput length={6} value={value} onChange={setValue} label="Code" />
      <output>{value}</output>
    </>
  );
}

describe("CodeInput", () => {
  it("advances focus as digits are typed", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    await userEvent.type(boxes[0]!, "1");
    expect(boxes[1]).toHaveFocus();
  });

  it("accepts a pasted six-digit code across all boxes", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    boxes[0]!.focus();
    await userEvent.paste("123456");
    expect(screen.getByRole("status")).toHaveTextContent("123456");
  });

  it("steps back on backspace in an empty box", async () => {
    render(<Harness />);
    const boxes = screen.getAllByRole("textbox");
    await userEvent.type(boxes[0]!, "1");
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(boxes[0]).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/auth/components/code-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build `code-input.tsx`**

`"use client"`. Six `<input inputMode="numeric" maxLength={1}>` boxes, each `flex-1 h-14 rounded-[10px] border bg-card text-center font-mono text-[22px]` per artboard `1f`. Keep the value in the parent; each box renders `value[i] ?? ""`. On change take the last typed character, splice it in, and focus the next box; on `Backspace` in an empty box focus the previous; on paste, take the first six digits and fill all boxes. Wrap in a `<fieldset>` with a visually hidden `<legend>` from the `label` prop.

- [ ] **Step 4: Build the hook, form and page**

`use-two-factor-challenge.ts` wraps `twoFactorChallenge` in `useMutation`, and on success invalidates `authKeys.session()` — note the call; the keys in `features/auth/keys.ts` are functions, and passing the function itself silently matches nothing. The form auto-submits once six digits are entered — and must guard against double submission while `isPending`. The page renders `<AuthCard headline="Enter your code" subtitle="Open your authenticator app.">` with a `Back to sign in` footer link.

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run features/auth/components/code-input.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add features/auth app/\(auth\)/login
git commit -m "feat(auth): two-factor challenge with a six-box code input"
```

---

### Task 4: Register and check-your-email

Not designed — follow the artboard `1f` conventions listed in Global Constraints.

**Files:**
- Create: `features/auth/hooks/use-resend-verification.ts`, `features/auth/components/register-form.tsx`, `check-email-panel.tsx`, `app/(auth)/register/page.tsx`
- Test: `features/auth/components/register-form.test.tsx`

**Interfaces:**
- Consumes: `useRegister()`; `registerSchema` (`name` 1–120, `email` max 254, `password` 8–128); `resendVerification()`.
- Produces: `<RegisterForm onRegistered={(email) => void} />`, `<CheckEmailPanel email />`.

- [ ] **Step 1: Write the failing test**

```tsx
// features/auth/components/register-form.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterForm } from "./register-form";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-register", () => ({
  useRegister: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("RegisterForm", () => {
  it("rejects a password under 8 characters, matching the backend rule", async () => {
    render(wrap(<RegisterForm onRegistered={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Amina Mohamed");
    await userEvent.type(screen.getByLabelText("Email"), "amina@sparktrading.co.ke");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/at least 8/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/auth/components/register-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the form and panel**

`register-form.tsx`: name, email, password fields; a password hint under the field at `text-xs text-muted-3` reading "At least 8 characters."; primary button `Create account`; calls `onRegistered(email)` in `onSuccess`. Map `DUPLICATE_EMAIL`-shaped 409s and any 422 onto the email field.

`check-email-panel.tsx`: `Mail` icon in a 44px `bg-primary-soft` circle, serif headline `Check your email`, body naming the address, and a `Resend` button that calls `resendVerification()` and then disables itself for 60 seconds with a live countdown. Show a `sonner` success toast on resend.

- [ ] **Step 4: Build the page**

`app/(auth)/register/page.tsx` holds the `email | null` state in a small client wrapper: null renders `<RegisterForm>`, otherwise `<CheckEmailPanel>`. Footer link: `Already have an account? Sign in`.

- [ ] **Step 5: Run the tests, then check the flow**

Run: `bunx vitest run features/auth/components/register-form.test.tsx` → PASS.
With the API running, register a real account and confirm the panel appears and the resend button counts down.

- [ ] **Step 6: Commit**

```bash
git add features/auth app/\(auth\)/register
git commit -m "feat(auth): registration and the check-your-email panel"
```

---

### Task 5: Verify email, forgot password, reset password

Three token-driven pages. All three are public, so `proxy.ts` must let them through.

**Files:**
- Create: `features/auth/hooks/use-verify-email.ts`, `use-forgot-password.ts`, `use-reset-password.ts`, `features/auth/components/forgot-password-form.tsx`, `reset-password-form.tsx`, `verify-email-panel.tsx`, `app/(auth)/verify-email/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`
- Modify: `proxy.ts`
- Test: `features/auth/components/forgot-password-form.test.tsx`

**Interfaces:**
- Consumes: `verifyEmail({ token })`, `forgotPassword({ email })`, `resetPassword({ token, password })`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
// features/auth/components/forgot-password-form.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";

const mutate = vi.fn((_input, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
vi.mock("@/features/auth/hooks/use-forgot-password", () => ({
  useForgotPassword: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("ForgotPasswordForm", () => {
  it("shows the same neutral confirmation whether or not the address exists", async () => {
    render(wrap(<ForgotPasswordForm />));
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    // The API deliberately answers identically either way so the page cannot be
    // used to discover who has an account. The UI must not undo that.
    expect(await screen.findByText(/if that address exists/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/auth/components/forgot-password-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the three flows**

- **Verify email** — `page.tsx` reads `?token=`, and a client child fires `useVerifyEmail()` once on mount (guard with a ref so React strict-mode double-invocation does not double-submit). Three states: verifying (spinner), success (`CircleCheck` in a `bg-success-soft` circle, headline "Your email is confirmed", `Continue` button to `/overview`), expired (headline "That link has expired").

  **The expired state must branch on whether there is a session.** `POST /auth/resend-verification` requires one (see `docs/API-ROUTES.md`, "Three gates that bite"), and this page is routinely opened on a *different device* from the one that registered — laptop signup, phone email. So: when `useSession()` has a user, show the working `Resend` button; when it does not, show "Sign in to send a new link" pointing at `/login`. Offering a Resend button that 401s is the bug this note exists to prevent.
- **Forgot password** — one email field, button `Send reset link`, then the neutral confirmation panel.
- **Reset password** — `?token=`, new password + confirm with a `.refine` equality check, then redirect to `/login` with a success toast.

- [ ] **Step 4: Open the routes in `proxy.ts`**

Add `/verify-email`, `/forgot-password`, `/reset-password` to the paths the proxy allows without a session cookie. Do **not** add them to the guest-only redirect list — a signed-in user following a verification link must still reach the page.

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run features/auth` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add features/auth app/\(auth\) proxy.ts
git commit -m "feat(auth): email verification and password reset flows"
```

---

### Task 6: Accept invite

**Files:**
- Create: `features/auth/hooks/use-accept-invite.ts`, `features/auth/components/accept-invite-form.tsx`, `app/(auth)/accept-invite/page.tsx`
- Modify: `proxy.ts`
- Test: `features/auth/components/accept-invite-form.test.tsx`

**Interfaces:**
- Consumes: `acceptInvite(input)`; `acceptInviteSchema` (`token`, `name`, `password`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
// features/auth/components/accept-invite-form.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcceptInviteForm } from "./accept-invite-form";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-accept-invite", () => ({
  useAcceptInvite: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("AcceptInviteForm", () => {
  it("sends the token from the URL along with the typed details", async () => {
    render(wrap(<AcceptInviteForm token="inv_abc123" />));
    await userEvent.type(screen.getByLabelText("Your name"), "Yusuf Ali");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Join the team" }));

    expect(mutate).toHaveBeenCalledWith(
      { token: "inv_abc123", name: "Yusuf Ali", password: "secret123" },
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/auth/components/accept-invite-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the form and page**

Headline `Join the team`. Fields: `Your name`, `Password`. Button `Join the team`. On success the API sets a session, so push to `/overview`. A missing or expired token renders a calm panel: "That invitation has expired — ask your manager to send a new one." Add `/accept-invite` to the proxy's public paths.

- [ ] **Step 4: Run the test**

Run: `bunx vitest run features/auth/components/accept-invite-form.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add features/auth app/\(auth\)/accept-invite proxy.ts
git commit -m "feat(auth): accept an invitation"
```

---

### Task 7: The organization slice and the onboarding wizard

The first feature slice built with the layered architecture. `POST /organizations` requires **name, timezone, mainCurrency, exchangeCurrency and exchangeRate together** — there is no partial create, which is why currency is a wizard step rather than a later setting.

**Files:**
- Create: `features/organization/types.ts`, `schemas/organization.schema.ts`, `services/organization.service.ts`, `keys.ts`, `hooks/use-create-organization.ts`, `hooks/use-organization.ts`, `components/onboarding-wizard.tsx`, `step-business.tsx`, `step-currency.tsx`, `step-invite.tsx`, `app/(auth)/onboarding/page.tsx`
- Modify: `config/routes.ts`
- Test: `features/organization/schemas/organization.schema.test.ts`, `features/organization/components/onboarding-wizard.test.tsx`

**Interfaces:**
- Consumes: `apiPost`, `apiGet`, `createQueryKeys`.
- Produces:
  - `useOrganization(): { timezone: string; currency: string; isLoading: boolean }` — **every later task depends on this** for `formatMoney` and `formatDate`. It reads `useSession().data.organization.timezone` and the currency config, so it never triggers a second request on a page that already has the session.
  - `useCreateOrganization(): UseMutationResult<Organization, ApiError, CreateOrganizationInput>`

- [ ] **Step 1: Write the failing schema test**

```ts
// features/organization/schemas/organization.schema.test.ts
import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "./organization.schema";

describe("createOrganizationSchema", () => {
  it("accepts a complete business", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Spark Trading Ltd",
      timezone: "Africa/Nairobi",
      mainCurrency: "USD",
      exchangeCurrency: "KES",
      exchangeRate: 130,
    });
    expect(result.success).toBe(true);
  });

  it("requires a 3-letter ISO currency code", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Spark Trading Ltd",
      timezone: "Africa/Nairobi",
      mainCurrency: "DOLLARS",
      exchangeCurrency: "KES",
      exchangeRate: 130,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive exchange rate — the backend has no default", () => {
    for (const exchangeRate of [0, -1]) {
      const result = createOrganizationSchema.safeParse({
        name: "Spark Trading Ltd",
        timezone: "Africa/Nairobi",
        mainCurrency: "USD",
        exchangeCurrency: "KES",
        exchangeRate,
      });
      expect(result.success, `rate ${exchangeRate} should be rejected`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/organization`
Expected: FAIL — module not found.

- [ ] **Step 3: Build types, schema, service, keys and hooks**

Mirror `../Backend/src/validators/organization.validation.ts` exactly: `name` 1–120, `timezone` 1–100, both currencies `/^[A-Za-z]{3}$/` uppercased, `exchangeRate` a positive finite number. Service: `createOrganization`, `getCurrentOrganization`, `getCurrencyConfig`. `useOrganization` composes the session and the currency config and returns `{ timezone, currency, isLoading }`.

- [ ] **Step 4: Write the failing wizard test**

```tsx
// features/organization/components/onboarding-wizard.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "./onboarding-wizard";

const mutate = vi.fn();
vi.mock("@/features/organization/hooks/use-create-organization", () => ({
  useCreateOrganization: () => ({ mutate, isPending: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("OnboardingWizard", () => {
  it("will not advance past step one without a business name", async () => {
    render(wrap(<OnboardingWizard emailVerified />));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/business name is required/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Main currency")).not.toBeInTheDocument();
  });

  it("blocks creation entirely when the email is unverified", () => {
    render(wrap(<OnboardingWizard emailVerified={false} />));
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `bunx vitest run features/organization/components`
Expected: FAIL — module not found.

- [ ] **Step 6: Build the wizard**

Three steps with a thin progress rule at the top (three segments, the active one `bg-primary`). Step 1 business: `name`, `timezone` (searchable select defaulting to `Intl.DateTimeFormat().resolvedOptions().timeZone`). Step 2 currency: `mainCurrency`, `exchangeCurrency`, `exchangeRate` in a mono input, with a live helper line "1 USD = 130 KES". Step 3 invite (skippable): up to three email + role rows; **collect them, but do not send them** — member invitations are a later slice; on finish, ignore the rows and push to `/overview`, leaving a `// TODO(slice: members)` comment. Validate each step before advancing; submit the whole payload once at the end, because the API has no partial create.

When `emailVerified` is false, render an inline notice — "Verify your email before creating a business." with a resend link — and disable the flow. This mirrors the backend's `requireVerifiedEmail` on `POST /organizations`; without it the user fills three steps and is then refused by a 403.

- [ ] **Step 7: Run the tests**

Run: `bunx vitest run features/organization` → all PASS.

- [ ] **Step 8: Commit**

```bash
git add features/organization app/\(auth\)/onboarding config/routes.ts
git commit -m "feat(organization): onboarding wizard and the organization slice"
```

---

### Task 8: Shell parity with the canvas

The shell exists but was built from the written brief, before the canvas. Bring it to the canvas's exact measurements. Read artboards `1b` (`:1908`) and `1c` (`:2050`) first.

**Files:**
- Modify: `components/layout/sidebar.tsx`, `nav.tsx`, `org-menu.tsx`, `user-menu.tsx`, `topbar.tsx`, `mobile-nav.tsx`, `app/(app)/layout.tsx`
- Create: `features/auth/components/unverified-email-strip.tsx`
- Test: `components/layout/nav-utils.test.ts`, `features/auth/components/unverified-email-strip.test.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `FOOTER_ITEMS`, `ROUTES`; `useSession`, `useCan`, `useUiStore`; `useResendVerification()` from Task 4.
- Produces: the shell every `(app)` page renders inside.

- [ ] **Step 1: Lock the existing nav logic with a characterization test**

`nav-utils.ts` was written in the foundation and is untested. It is the piece most likely to regress while restyling. This test asserts current behaviour rather than driving new behaviour — **it should pass on the first run.** If any case fails, the implementation is wrong and must be fixed, not the test. Note `resolveActiveHref` returns `string | null`, not `undefined`.

```ts
// components/layout/nav-utils.test.ts
import { describe, expect, it } from "vitest";
import { getInitials, resolveActiveHref } from "./nav-utils";

describe("resolveActiveHref", () => {
  const hrefs = ["/overview", "/sales", "/sales/new", "/products", "/team", "/team/roles"];

  it("prefers the longest match so a child route does not light up its parent", () => {
    expect(resolveActiveHref("/sales/new", hrefs)).toBe("/sales/new");
    expect(resolveActiveHref("/team/roles", hrefs)).toBe("/team/roles");
  });

  it("marks the parent active for a detail route with no nav entry of its own", () => {
    expect(resolveActiveHref("/sales/64f0c9a2b1e4d5a6c7b8e9f0", hrefs)).toBe("/sales");
  });

  it("does not treat a shared prefix as a match", () => {
    expect(resolveActiveHref("/products-import", hrefs)).toBeNull();
  });

  it("returns null for an unknown route", () => {
    expect(resolveActiveHref("/nowhere", hrefs)).toBeNull();
  });
});

describe("getInitials", () => {
  it("takes the first letter of the first and last name", () => {
    expect(getInitials("Amina Mohamed")).toBe("AM");
  });

  it("handles a single name and empty input without throwing", () => {
    expect(getInitials("Amina")).toBe("A");
    expect(getInitials("")).toBe("");
  });
});
```

Run: `bunx vitest run components/layout/nav-utils.test.ts` → expected PASS.

- [ ] **Step 2: Write the failing test for the resend strip**

This is the genuinely new behaviour in this task — the foundation left the strip's button inert with a `// TODO(feature: auth)`.

```tsx
// features/auth/components/unverified-email-strip.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnverifiedEmailStrip } from "./unverified-email-strip";

const mutate = vi.fn();
vi.mock("@/features/auth/hooks/use-resend-verification", () => ({
  useResendVerification: () => ({ mutate, isPending: false }),
}));

describe("UnverifiedEmailStrip", () => {
  it("resends the verification email when the action is clicked", async () => {
    render(<UnverifiedEmailStrip />);
    await userEvent.click(screen.getByRole("button", { name: "Resend verification" }));
    expect(mutate).toHaveBeenCalledOnce();
  });
});
```

Run: `bunx vitest run features/auth/components/unverified-email-strip.test.tsx`
Expected: FAIL — `Cannot find module './unverified-email-strip'`.

- [ ] **Step 3: Bring the sidebar to canvas measurements**

From `docs/design/TradeOs-UI.dc.html:1908–2049`: sidebar 240px on `bg-card` with a `#E3E1D8` right border; org block 12px padding, a 32px `rounded-lg bg-primary-soft text-primary` mono initial, a 10px mono uppercase `text-muted-2` "Business" label above a 13px medium name, 14px chevron; nav area `padding: 4px 12px 12px`, `gap: 2px`; group labels 11px medium uppercase `tracking-[0.06em] text-muted-3` with `padding: 10px 10px 6px`; items 36px tall, `rounded-lg`, `padding: 0 10px`, `gap: 10px`, 18px icon, 13px label — **active items are `bg-primary-soft` with `text-primary` (`#D97757`) and `font-weight: 500`**; footer separated by a top border with `padding: 10px 12px`, holding Help Center then the user row on `bg-muted` with a 30px `bg-info-soft text-info` circle of initials, 13px medium name and 11px `text-muted-foreground` role.

- [ ] **Step 4: Bring the topbar to canvas measurements**

56px tall, `padding: 0 24px`, bottom border. Breadcrumb: 13px `text-muted-foreground` parents, 14px `text-border-strong` chevrons, `text-primary` medium current crumb. Right: a 260×34 search trigger with a 15px icon, 13px `text-muted-3` placeholder and a `⌘K` chip (10px mono, `bg-muted` , `rounded-[5px]`), then a 34px square theme toggle. Extract the unverified strip into `features/auth/components/unverified-email-strip.tsx` (it is auth's concern, not the layout's) and make the test from Step 2 pass: `bg-warning-soft`, `border-bottom: 1px solid #E8DCBC`, `padding: 8px 24px`, 15px `text-warning` icon, 13px `text-warning-strong` text reading "Your email isn't verified yet. Some actions are limited.", and an underlined `text-warning` medium `Resend verification` button calling `useResendVerification().mutate()`, toasting on success and disabling for 60s. The topbar renders it only when `session.user.emailVerified === false`.

- [ ] **Step 5: Content wrapper**

`app/(app)/layout.tsx` main region: `padding: 32px`, `display: flex; flex-direction: column; gap: 24px`, `max-width: 1280px`. At 1440 this reproduces the canvas exactly.

- [ ] **Step 6: Verify all four sidebar variants**

Run `bun run dev` and check against artboard `1b`: manager (11 items), seller (7 items — no Reports, Members or Settings), the collapsed rail, and the mobile drawer under 1024px.

- [ ] **Step 7: Run the checks and commit**

```bash
bun run check
git add components/layout app/\(app\)/layout.tsx
git commit -m "feat(shell): match the design canvas measurements exactly"
```

---

### Task 9: Dashboard data layer

**Files:**
- Create: `features/dashboard/types.ts`, `keys.ts`, `services/dashboard.service.ts`, `hooks/use-dashboard.ts`
- Test: `features/dashboard/services/dashboard.service.test.ts`

**Interfaces:**
- Consumes: `apiGet`, `createQueryKeys`.
- Produces:
  - `type DashboardResponse = { available: string[]; sections: Partial<DashboardSections> }`
  - `DashboardSections` with the ten section shapes, typed from `../Backend/src/services/dashboard/*.section.ts`
  - `useDashboard(): UseQueryResult<DashboardResponse, ApiError>`
  - `useDashboardSection<K>(key: K)` returning that section or `undefined`

- [ ] **Step 1: Read the backend section builders**

Read every file in `../Backend/src/services/dashboard/`. Each `build*Section` function's return object is the wire shape.

**This task is complete — the verified `DashboardSections` type is in `features/dashboard/types.ts`.** Five field names differ from an earlier draft of this step and are worth naming, because each was a silent `undefined` waiting to happen:

- **`sales.trend7`, not `sales.trend`** (`sales.section.ts:39`). This one bites hardest: `sections.sales.trend` type-errors now, but read as `undefined` before the type existed.
- **`debts` also returns `dueWithin7Days: { count, amount }`** (`debts.section.ts:105`) — free data for the Debts panel.
- **`me.role` is `{ id, name }`**, an object, not a name string.
- **`organization` also returns `timezone`**, and `currency` is `{ main, exchange, rate } | null`, not a code. The `null` case is real — a business with no currency config has no code to pass to `formatMoney`, so do not fall back to `"USD"`.
- **`stock.lowStock[].threshold` is `number | null`.**

Two permission facts that shape the Overview: `team` needs `members:view` **and** `members:invite` together, so a Seller is excluded despite holding `members:view`; and `mySales` is gated on `sales:create`, an action permission, so a Manager receives **both** `mySales` and `sales` — they are not an either/or role switch.

- [ ] **Step 2: Write the failing test**

```ts
// features/dashboard/services/dashboard.service.test.ts
import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import { getDashboard } from "./dashboard.service";

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return { ...actual, apiGet: vi.fn() };
});

describe("getDashboard", () => {
  it("requests the dashboard and returns the envelope's data unchanged", async () => {
    const { apiGet } = await import("@/lib/api/client");
    const payload = {
      available: ["organization", "me", "sales"],
      sections: { team: { activeCount: 4, invitedCount: 1 } },
    };
    vi.mocked(apiGet).mockResolvedValue(payload);

    await expect(getDashboard()).resolves.toEqual(payload);
    expect(apiGet).toHaveBeenCalledWith("/dashboard");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bunx vitest run features/dashboard`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement types, keys, service and hook**

`useDashboard` uses `staleTime: 60_000` — the Overview is a glance, not a live board, and every section is recomputed server-side on each call.

- [ ] **Step 5: Run the test and commit**

```bash
bunx vitest run features/dashboard
git add features/dashboard
git commit -m "feat(dashboard): typed dashboard service and hook"
```

---

### Task 10: StatCard, SectionStrip and BarChart

The three components artboard `1a` (`:1734`) and `1c` (`:2130–2180`) define. Everything on the Overview is built from them.

**Files:**
- Create: `features/dashboard/components/stat-card.tsx`, `section-strip.tsx`, `bar-chart.tsx`, `components/shared/error-card.tsx`
- Test: `features/dashboard/components/stat-card.test.tsx`, `bar-chart.test.tsx`

**Interfaces:**
- Produces:
  - `<StatCard label value spark? delta? deltaTone? foot? />` — `value` is pre-formatted by the caller
  - `<SectionStrip title info? actions?>{children}</SectionStrip>`
  - `<BarChart series axisLabels bucketLabels tone? height? />`
  - `<ErrorCard error retry? />`

- [ ] **Step 1: Write the failing tests**

```tsx
// features/dashboard/components/stat-card.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders the label, the value and the footer delta", () => {
    render(
      <StatCard
        label="Today's revenue"
        value="USD 20,320.00"
        delta="+0.94%"
        deltaTone="positive"
        foot="vs last week"
      />,
    );
    expect(screen.getByText("Today's revenue")).toBeInTheDocument();
    expect(screen.getByText("USD 20,320.00")).toBeInTheDocument();
    expect(screen.getByText("+0.94%")).toBeInTheDocument();
  });

  it("omits the footer row entirely when there is no delta or foot text", () => {
    const { container } = render(<StatCard label="Sales today" value="18" />);
    expect(container.querySelector("[data-slot='stat-card-foot']")).toBeNull();
  });
});
```

```tsx
// features/dashboard/components/bar-chart.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart";

describe("BarChart", () => {
  it("scales every bar against the largest value", () => {
    render(
      <BarChart
        series={[10, 20, 40]}
        bucketLabels={["Mon", "Tue", "Wed"]}
        axisLabels={["40", "20", "0"]}
      />,
    );
    const bars = screen.getAllByRole("presentation");
    expect(bars[2]).toHaveStyle({ height: "100%" });
    expect(bars[1]).toHaveStyle({ height: "50%" });
  });

  it("renders a flat baseline rather than dividing by zero when every value is 0", () => {
    render(
      <BarChart series={[0, 0]} bucketLabels={["Mon", "Tue"]} axisLabels={["0"]} />,
    );
    for (const bar of screen.getAllByRole("presentation")) {
      expect(bar).toHaveStyle({ height: "0%" });
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run features/dashboard/components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Build the components**

`StatCard`: `bg-card border rounded-[10px] p-[16px_18px]` with `box-shadow: inset 0 0 0 3px var(--color-background)` — that inset ring is what gives the canvas its double-border look. Label 11px mono uppercase `tracking-[0.08em] text-muted-foreground`; value 24px mono medium `whitespace-nowrap`; sparkline a 36px-tall row of 4px-wide bars with `gap: 2px`; footer separated by `margin-top: 14px; padding-top: 12px; border-top`, with a 14px info icon, an 11px mono delta coloured by tone, and 12px `text-muted-foreground` text.

`SectionStrip`: header `bg-muted` with a bottom border, `padding: 10px 18px`, an 11px mono uppercase medium title, an optional 14px info icon, and a right-hand `actions` slot; body is `{children}`.

`BarChart`: bars are the canvas's stacked look — a column of small rounded squares. Compute `height: (value / max) * 100%`, guarding `max === 0`. Give each bar `role="presentation"` and the wrapper an `aria-label` summarising the series, since the numbers are already in the table beneath.

`ErrorCard`: title "Couldn't load this", the error's `message`, and the `requestId` in an 11px mono muted line — brief §8.4 requires it.

- [ ] **Step 4: Run the tests and commit**

```bash
bunx vitest run features/dashboard/components
git add features/dashboard/components components/shared/error-card.tsx
git commit -m "feat(dashboard): stat card, section strip and bar chart"
```

---

### Task 11: The Overview page

Assembles the sections. `GET /dashboard` returns only what the caller may see, so the page is a stack of optional sections — a Seller and an Owner render the same component.

**Files:**
- Create: `features/dashboard/components/overview.tsx`, `sales-section.tsx`, `my-sales-section.tsx`, `debts-section.tsx`, `stock-section.tsx`, `staff-section.tsx`, `projects-section.tsx`, `announcements-section.tsx`, `team-section.tsx`, `first-steps-card.tsx`
- Modify: `app/(app)/overview/page.tsx`
- Test: `features/dashboard/components/overview.test.tsx`

**Interfaces:**
- Consumes: `useDashboard()`, `useSession()`, `useOrganization()`, `StatCard`, `SectionStrip`, `BarChart`, `ErrorCard`, `formatMoney`, `formatDate`.

- [ ] **Step 1: Write the failing test**

```tsx
// features/dashboard/components/overview.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Overview } from "./overview";

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({ timezone: "Africa/Nairobi", currency: "USD", isLoading: false }),
}));

const dashboard = vi.fn();
vi.mock("@/features/dashboard/hooks/use-dashboard", () => ({
  useDashboard: () => dashboard(),
}));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("Overview", () => {
  it("renders a seller's own figures and no manager analytics", () => {
    dashboard.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        available: ["organization", "me", "mySales"],
        sections: {
          mySales: {
            today: { count: 12, total: 4320 },
            thisMonth: { count: 210, total: 88400 },
            recent: [],
          },
        },
      },
    });

    render(wrap(<Overview name="Yusuf" />));
    expect(screen.getByText(/my sales today/i)).toBeInTheDocument();
    expect(screen.queryByText(/sales trend/i)).not.toBeInTheDocument();
  });

  it("shows First steps instead of stat cards for a business with no sales", () => {
    dashboard.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        available: ["organization", "me", "sales"],
        sections: {
          // NOTE: `trend7`, not `trend` — verified against
          // ../Backend/src/services/dashboard/sales.section.ts:39.
          sales: {
            today: { revenue: 0, grossProfit: 0, count: 0 },
            thisMonth: { revenue: 0, grossProfit: 0, count: 0 },
            trend7: { granularity: "day", series: [] },
          },
        },
      },
    });

    render(wrap(<Overview name="Amina" />));
    expect(screen.getByText("First steps")).toBeInTheDocument();
  });

  it("shows the error card with the request id when the call fails", () => {
    dashboard.mockReturnValue({
      isPending: false,
      data: undefined,
      error: { message: "Something went wrong", requestId: "req_abc123", status: 500 },
    });

    render(wrap(<Overview name="Amina" />));
    expect(screen.getByText(/req_abc123/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run features/dashboard/components/overview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the sections**

Follow artboard `1c` top to bottom: page header (32px serif `Good morning, {firstName}.` plus a 13px `text-muted-foreground` line reading `Monday, 07 Sep 2026 · Africa/Nairobi`, and a 40px `New sale` primary button gated on `sales:create`); a four-column stat grid with `gap: 16px`; the sales-trend `SectionStrip` with a `Revenue · Profit · Count` segmented control; then the two-column bands for Debts/Stock and Staff/Projects; then Announcements and Team.

Greeting by hour **in the business timezone**, not the browser's. Render each section only when its key is present in `data.sections`.

- [ ] **Step 4: Build the First steps card**

When `sales` is present but `thisMonth.count === 0`, replace the stat grid with the artboard `1e` card: serif "First steps", the line "Three things and the counter is ready.", and three checklist rows — Add a product, Record your first sale, Invite a teammate — each linking to its route and each hidden if the user lacks the permission. The chart area shows "Nothing to chart yet".

- [ ] **Step 5: Wire the page**

`app/(app)/overview/page.tsx` stays a Server Component holding metadata; it renders a small client child that reads `useSession()` for the first name and renders `<Overview>`. Loading state is a skeleton in the shape of the header, four cards and the chart — never a spinner.

- [ ] **Step 6: Run the tests**

Run: `bunx vitest run features/dashboard` → all PASS.

- [ ] **Step 7: Verify against the canvas in both themes**

With the API running and a seeded business, open `/overview` at 1440px. Compare with artboards `1c` (light, unverified strip) and `1d` (dark). Then sign in as a Seller and compare with `1e`.

- [ ] **Step 8: Full check and commit**

```bash
bun run check
git add features/dashboard app/\(app\)/overview
git commit -m "feat(dashboard): the Overview page"
```

---

### Task 12: Route protection — permissions and the no-organization case

The foundation shipped `RequirePermission` but nothing calls it, and only the 8 top-level nav items carry a permission. So today a Seller who types `/reports` into the address bar reaches the page, fires a request and gets a bare 403; and a user who registered but has no business yet is waved past `proxy.ts` into `/overview`, where `requireMember` fails.

**Why this is client-side.** `proxy.ts` cannot do it: it would have to fetch `/auth/me` on every request, and the Next 16 Proxy docs say plainly that Proxy is not a session or authorization solution and must not be used for slow data fetching. The real enforcement is the API's 403 — this task is the UX layer that stops a person reaching a screen that can only fail, and shows them something calm when they do.

**Files:**
- Create: `lib/auth/route-permissions.ts` (+ `.test.ts`), `components/shared/forbidden-screen.tsx`, `components/layout/route-guard.tsx`
- Modify: `config/routes.ts` (add the permission map), `app/(app)/layout.tsx` (wrap children)
- Test: `lib/auth/route-permissions.test.ts`

**Interfaces:**
- Consumes: `ROUTES`, `PERMISSIONS`, `Permission`, `useSession`, `RequirePermission`.
- Produces: `ROUTE_PERMISSIONS: Record<string, Permission>`, `resolveRoutePermission(pathname): Permission | null`, `<RouteGuard>{children}</RouteGuard>`, `<ForbiddenScreen />`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/auth/route-permissions.test.ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { resolveRoutePermission } from "./route-permissions";

describe("resolveRoutePermission", () => {
  it("maps a top-level page to its permission", () => {
    expect(resolveRoutePermission("/reports")).toBe(PERMISSIONS.REPORTS_VIEW);
    expect(resolveRoutePermission("/products")).toBe(PERMISSIONS.PRODUCTS_VIEW);
  });

  it("gives a sub-route its own stricter permission, not its parent's", () => {
    // A Seller holds sales:view but not sales:void; they may open /sales but
    // must not reach /sales/new without sales:create.
    expect(resolveRoutePermission("/sales/new")).toBe(PERMISSIONS.SALES_CREATE);
    expect(resolveRoutePermission("/products/import")).toBe(PERMISSIONS.PRODUCTS_CREATE);
    expect(resolveRoutePermission("/team/roles")).toBe(PERMISSIONS.ROLES_VIEW);
  });

  it("falls back to the parent's permission for a detail route", () => {
    expect(resolveRoutePermission("/products/64f0c9a2b1e4d5a6c7b8e9f0")).toBe(
      PERMISSIONS.PRODUCTS_VIEW,
    );
    expect(resolveRoutePermission("/reports/sales")).toBe(PERMISSIONS.REPORTS_VIEW);
  });

  it("does not treat a shared prefix as a match", () => {
    expect(resolveRoutePermission("/products-import")).toBeNull();
  });

  it("returns null for pages everyone may see", () => {
    for (const path of ["/overview", "/announcements", "/help", "/account"]) {
      expect(resolveRoutePermission(path), path).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run lib/auth/route-permissions.test.ts`
Expected: FAIL — `Cannot find module './route-permissions'`.

- [ ] **Step 3: Build the map and the resolver**

In `config/routes.ts`, add `ROUTE_PERMISSIONS` covering **every** guarded path, not just nav items. Derive the values from `docs/API-ROUTES.md` — the permission that gates the page's primary endpoint:

| Path | Permission |
|---|---|
| `/sales` | `SALES_VIEW` |
| `/sales/new` | `SALES_CREATE` |
| `/products` | `PRODUCTS_VIEW` |
| `/products/import` | `PRODUCTS_CREATE` |
| `/customers` | `CUSTOMERS_VIEW` |
| `/debts` | `DEBTS_VIEW` |
| `/reports` | `REPORTS_VIEW` |
| `/projects` | `PROJECTS_VIEW` |
| `/team` | `MEMBERS_INVITE` |
| `/team/roles` | `ROLES_VIEW` |
| `/settings` | `ORGANIZATION_UPDATE` |

`/overview`, `/announcements`, `/help` and `/account` are ungated — every member may see them.

`resolveRoutePermission` uses **longest-prefix matching with a `/` boundary**, the same rule as `resolveActiveHref`: `/products/import` must beat `/products`, and `/products-import` must match neither. Reuse that logic rather than writing a second, subtly different matcher — extract it if that is cleanest, and say so in a comment.

- [ ] **Step 4: Build `ForbiddenScreen` and `RouteGuard`**

`forbidden-screen.tsx`: the calm full-page refusal brief §8.4 asks for — a centred column with a `Lock` icon, serif "You don't have access to this", one muted line ("Ask an owner or manager if you need it."), and a `Back to overview` button. No error styling; this is not a failure, it is a boundary.

`route-guard.tsx` (`"use client"`) does three things in order, and the order matters:

```tsx
const { data, isPending } = useSession();
const pathname = usePathname();

// 1. Session still resolving — render nothing rather than flashing a refusal.
if (isPending) return null;

// 2. Signed in but no business yet. `requireMember` would fail on every
//    endpoint in here, so send them to the one screen that fixes it. The
//    proxy cannot catch this: it sees a valid cookie and nothing more.
if (data && !data.organization) {
  redirect(ROUTES.onboarding);
}

// 3. The permission gate.
const permission = resolveRoutePermission(pathname);
if (!permission) return children;
return (
  <RequirePermission permission={permission} fallback={<ForbiddenScreen />}>
    {children}
  </RequirePermission>
);
```

Wrap `{children}` in `app/(app)/layout.tsx` with `<RouteGuard>`. The layout stays a Server Component; `RouteGuard` is the client boundary.

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run lib/auth/route-permissions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify by hand**

With the API running, sign in as a **Seller** and type `/reports`, `/team` and `/settings` into the address bar. Each must show the ForbiddenScreen, not a crash and not a bare 403 body. Then sign in as a Manager and confirm all three open normally.

- [ ] **Step 7: Commit**

```bash
bun run check
git add lib/auth components/shared/forbidden-screen.tsx components/layout/route-guard.tsx config/routes.ts app/\(app\)/layout.tsx
git commit -m "feat(auth): guard routes by permission and route new users to onboarding"
```

---

## Done when

- A new person can register, verify their email, create a business, sign in, and see a real Overview.
- An invited person can accept an invitation and land in the same shell with a Seller's seven nav items.
- A Seller who types `/reports`, `/team` or `/settings` into the address bar gets the ForbiddenScreen, and a signed-in user with no business is sent to onboarding rather than to a failing dashboard.
- `bun run check` passes and `bun run build` succeeds.
- `/login`, `/overview` (manager, light and dark) and `/overview` (seller) match artboards `1f`, `1c`, `1d` and `1e` at 1440px.

## Explicitly out of scope

Passkey login (the button is rendered disabled), sending the invitations collected in onboarding step 3, the `⌘K` search, and every screen in artboards `2a`–`2m` and `3a`. Each gets its own plan.
