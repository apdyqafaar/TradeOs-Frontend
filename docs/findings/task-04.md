# Task 4 — register and check-your-email

## `POST /auth/register` really does set the session cookie, so Resend works immediately

**What:** 201 with `{ user: { id, name, email, emailVerified, image } }` under the message
"Your account is ready" — no organization, no role, no permissions. The `Set-Cookie` is written
*before* the body, unconditionally, on the one success path.

**Evidence:** `../Backend/src/controller/auth.controller.ts:31` calls
`setSessionCookie(res, result.token, result.expiresAt)`, then line 41 `createdResponse(...)`, which
is `successResponse(res, message, 201, data)` (`../Backend/src/util/responses.ts:47`). The token
comes from `issueSession` at the end of `register` (`../Backend/src/services/auth.service.ts:159`),
after the transaction commits — so a session exists whenever a 201 is returned. `publicUser` is
`auth.controller.ts:19`.

**So what:** the check-your-email panel may offer a working Resend, even though
`POST /auth/resend-verification` needs a session. That is *only* true on the device that just
registered. The expired-link screen (Task 5) is the case where the session may be missing.

## A duplicate email is a 409 with code `CONFLICT` — there is no `DUPLICATE_EMAIL`

**What:** the plan's Step 3 says "map `DUPLICATE_EMAIL`-shaped 409s". No such code exists, in this
codebase or the backend. Registration throws a bare `ConflictError`, whose default code is
`"CONFLICT"`, from two places — the pre-check and the unique-index race — both with the message
"An account with that email already exists".

**Evidence:** `../Backend/src/services/auth.service.ts:102` and `:136`;
`../Backend/src/util/errors.ts:90-98` (`ConflictError(message, code = "CONFLICT")`).
`lib/api/errors.ts` has `CONFLICT` and no `DUPLICATE_EMAIL`; `grep -r DUPLICATE_EMAIL` over both
repos finds nothing.

**So what:** `register-form.tsx` branches on `API_ERROR_CODE.CONFLICT`, which is safe because a
taken address is the *only* conflict registration has. Do not add a `DUPLICATE_EMAIL` constant to
`API_ERROR_CODE` — nothing sends it. Any later screen that reads "409 means duplicate" should check
that its own endpoint has only one conflict before doing the same.

## `/register` is a guest-only path, so the check-your-email panel dies on refresh

**What:** registration sets a session cookie, and `proxy.ts` redirects anyone holding one away from
`/register`. The panel therefore lives only as long as the client-side state that produced it: a
reload, a back-then-forward, or any real navigation lands the user on `/overview` instead, having
never been told to check their inbox.

**Evidence:** `proxy.ts:35` `const GUEST_ONLY_PATHS = ["/login", "/register"]` and `:54`
`if (hasSession && GUEST_ONLY_PATHS.includes(pathname)) return NextResponse.redirect(new URL("/overview", ...))`.
The panel is state in `RegisterFlow`, not a route.

**So what:** not fixable from Task 4's file list — `proxy.ts` belongs to Tasks 5 and 7. The durable
fix is either to drop `/register` from `GUEST_ONLY_PATHS` (a signed-in-but-unverified user has
somewhere useful to be there) or to make check-your-email its own route. Until then, the shell's
unverified-email strip (Task 8) is the only thing that tells a returning user their address is
unconfirmed, which is an argument for building it early.

## Resending invalidates the link already in the user's inbox

**What:** `requestEmailVerification` deletes every outstanding `email_verification` row for the
address before minting the new token. A user who clicks Resend and then, out of habit, opens the
*first* email gets "that link has expired" and reasonably concludes the product is broken.

**Evidence:** `../Backend/src/services/auth.service.ts:576`
`await deleteVerificationsFor(user.email, "email_verification");` immediately before
`generateToken()` / `createVerification(...)` at `:578-583`.

**So what:** the copy should point at the *newest* email, not "the email". Worth saying "we sent a
new link — use the most recent email" in the resend toast if this ever confuses anyone. It is also
why the panel's Resend starts enabled but is not offered as a routine action.

## Resending to an already-verified account succeeds and sends nothing

**What:** `requestEmailVerification` returns early when `user.emailVerified` is true. The route
still answers 200 "Verification email sent", so `useResendVerification` toasts success and no mail
is sent.

**Evidence:** `../Backend/src/services/auth.service.ts:574`
`if (!user || user.emailVerified) return;`; the handler
(`../Backend/src/controller/auth.controller.ts:144-148`) awaits it and always calls
`successResponse`.

**So what:** harmless here — the panel only renders for an account that was just created. It matters
for Task 8's strip, which should render only when `session.user.emailVerified === false` (the plan
already says so); if it ever rendered optimistically it would cheerfully confirm sending an email
that never left.

## The cooldown is per-mount, and the limit that actually holds is 5 per hour

**What:** the 60-second lockout is `useState` in `CheckEmailPanel`. It does not survive a remount,
a reload, or a tab switch that unmounts the tree — a user who reloads can resend immediately. The
enforcement is server-side: the `resend-verification` rate-limit bucket allows 5 per hour per IP.
Sixty seconds times five spends the whole hourly allowance in five minutes.

**Evidence:** `../Backend/src/routes/v1/auth.route.ts:65`
`const verifyLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, name: "resend-verification" });`
mounted at `:109`, ahead of `validate` and `requireAuth`.

**So what:** deliberate — the cooldown is a double-click guard, not a control, and it is kept in the
component (not in `useResendVerification`) precisely so Task 8's strip can choose its own. If a
persistent cooldown is ever wanted, key it off a timestamp in `localStorage` rather than moving it
into the hook: two mounted copies of the hook would each keep their own state and neither would see
the other's.

## `POST /auth/resend-verification` takes no body, and a 401 from it is a hard redirect

**What:** its validator is `noBodySchema` — `z.object({}).strict().optional()` — so sending any
payload is a 422, not a silently-ignored field. And unlike the sign-in endpoints, it is not in the
client's `AUTH_ENTRY_PATHS`, so a 401 makes the interceptor redirect to `/login` rather than
handing the error back to the form.

**Evidence:** `../Backend/src/validators/common.validation.ts:21`;
`../Backend/src/routes/v1/auth.route.ts:107-111`; `lib/api/client.ts:214-222` (`AUTH_ENTRY_PATHS`)
and `:311` `if (error.status === 401 && !isAuthEntryRequest(requestUrl)) redirectToLogin();`.

**So what:** the hook's mutation variable is `void` — call it `resend.mutate()`, never
`resend.mutate({})`. And no surface needs a "your session expired" branch for this call: the client
already navigates. `check-email-panel.tsx` documents that instead of carrying a dead branch.

## The plan's own test would have matched two elements if the password hint stayed visible

**What:** the plan asks for a permanent hint reading "At least 8 characters." and a test asserting
`findByText(/at least 8/i)`. The zod message is "Password must be at least 8 characters", so with
both on screen the query matches two elements and Testing Library throws
"Found multiple elements" — the test fails on a correct implementation.

**Evidence:** `features/auth/schemas/auth.schema.ts` (`min(8, "Password must be at least 8 characters")`)
against the hint text in the plan's Step 3.

**So what:** the hint and the error share one slot in `register-form.tsx` — the error replaces the
hint rather than sitting beside it. `aria-describedby` points at whichever is rendered, so the
field never describes itself with a missing id. Any later form pairing a hint with a validation
message that restates it should do the same.

## `RegisterFlow` lives in `register-form.tsx` because a page cannot be both

**What:** the plan puts the `email | null` state in "a small client wrapper" on the page, but
`app/(auth)/register/page.tsx` also needs `export const metadata`, which a `"use client"` module
may not export, and the task's file list adds no third file to put the wrapper in.

**Evidence:** `app/(auth)/register/page.tsx` is a Server Component rendering `<RegisterFlow />`,
exported from `features/auth/components/register-form.tsx` alongside `RegisterForm`.

**So what:** the headline changes with the state ("Create your account." → "Check your email"), so
`AuthCard` renders inside the client boundary here, unlike on `/login` where the page owns it. If a
later refactor wants the header server-rendered, the wrapper needs its own file
(`register-flow.tsx`) — not a `"use client"` page.

## Both a toast and a banner appear on a 429

**What:** `lib/api/client.ts` toasts on every 429 centrally, and the auth forms *also* render
`AuthErrorBanner` for `TOO_MANY_REQUESTS`. A rate-limited registration therefore says it twice, in
two different words.

**Evidence:** `lib/api/client.ts:307-310` (`toast.error(error.message)`) and the
`TOO_MANY_REQUESTS` case in both `login-form.tsx` and `register-form.tsx`.

**So what:** kept, because `login-form.tsx` established it and diverging silently would be worse
than being consistently noisy. If it is ever cleaned up, do it in one pass across every auth form —
the banner is the better of the two, since it stays on screen next to the button that failed.
