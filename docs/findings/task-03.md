# Task 3 — two-factor challenge

## The challenge token has no carrier: login gets it, drops it, and navigates away

**What:** `POST /auth/login` returns `{ twoFactorRequired: true, challengeToken, expiresAt }` and sets
**no cookie** on that branch. The token exists only in that one JSON body. `LoginForm` never reads
it — its success handler is `if (result.twoFactorRequired) { router.push(ROUTES.twoFactor); return; }`
— so `/login/2fa` loads as a fresh document with nothing to send to
`POST /auth/2fa/challenge`. As shipped, a 2FA account cannot complete a sign-in: it reaches the code
screen and the screen can only offer "sign in again". The plan is silent on the transport; Task 2
specifies exactly that `push` and Task 3 specifies only which service to call.

**Evidence:** `Backend/src/controller/auth.controller.ts:57-66` (the 2FA branch returns before
`setSessionCookie`). `features/auth/components/login-form.tsx` `onSuccess`.
`grep -rn "challengeToken" --include=*.ts --include=*.tsx .` finds four hits, all of them a type or a
comment — no read, no write, no storage, no query parameter.

**So what:** this task added the carrier but cannot add the call site, which is in another agent's
file. `features/auth/hooks/use-two-factor-challenge.ts` exports
`rememberTwoFactorChallenge({ challengeToken, expiresAt })`, and `login-form.tsx` needs one line
before its push:

```tsx
if (result.twoFactorRequired) {
  rememberTwoFactorChallenge(result);
  router.push(ROUTES.twoFactor);
  return;
}
```

Until that line lands, `/login/2fa` renders the expired panel for everyone. **The flow is not
end-to-end verifiable without it**, and nothing else in the repo will fail — no test, no typecheck,
no lint — to tell you.

## Why `sessionStorage` and not `?challenge=`

**What:** the obvious alternative is `router.push(`${ROUTES.twoFactor}?challenge=${token}`)`. It was
rejected. A challenge token is one correct six-digit guess away from a session cookie, and a URL
puts it in the browser history, in the `Referer` header of anything the page loads, in the address
bar over someone's shoulder, and in any proxy or CDN access log between the browser and the app.
`sessionStorage` is scoped to the one tab, dies with it, is never transmitted, and is unreadable
from another origin.

**Evidence:** `features/auth/hooks/use-two-factor-challenge.ts`; the storage key is
`tradeos:two-factor-challenge`. Every access is wrapped in `try`/`catch` because Safari private mode
and blocked site data make `sessionStorage` throw on access, not return `null`.

**So what:** if a later task needs the token somewhere else, use the same helpers rather than putting
it in the URL. The same argument applies to the passkey login ceremony, which is the other public
`/auth/*` route pair.

## A wrong code and a dead challenge are the same 401, on purpose

**What:** `POST /auth/2fa/challenge` answers `401 UNAUTHORIZED` both for "that code is wrong"
(`INVALID_CODE`) and for "this challenge is unknown, expired, already spent, or the account turned
2FA off" (`INVALID_CHALLENGE`). Only the human-readable `message` differs, and the repo rule is to
branch on `code`, never on `message`. So the UI **cannot** tell the two apart from the response, and
one banner has to serve both.

**Evidence:** `Backend/src/services/two-factor.service.ts:49-56` (the two message constants and the
comment explaining that separating them would narrow an attacker's search) and `:248-286`, where
every failure path throws `UnauthorizedError`, whose code is the constant `"UNAUTHORIZED"`
(`Backend/src/util/errors.ts:38-42`).

**So what:** the banner reads "That code isn't right. If it keeps failing, sign in again for a new
one." — it names both exits because the API will not say which applies. The one expiry signal that
*is* reliable is client-side: `expiresAt` from the login response. `TwoFactorForm` arms a timer on
it and flips to the expired panel without spending a request. Two related facts worth keeping: a
wrong code deliberately does **not** consume the challenge (`two-factor.service.ts:276-280`), so
retrying in place is correct and the boxes should be cleared rather than the user sent away; and the
endpoint is rate limited to **10 attempts per 15 minutes** (`Backend/src/routes/v1/auth.route.ts:191`),
which is what the `TOO_MANY_REQUESTS` branch is for.

## The challenge lives five minutes, and `expiresAt` is the only way the UI knows

**What:** `CHALLENGE_TTL_MS = 5 * 60_000`. Nothing in the response body says "five minutes"; the
client gets an absolute `expiresAt` and that is all.

**Evidence:** `Backend/src/services/two-factor.service.ts:47`.

**So what:** `expiresAt` has to be carried alongside the token, not discarded as decoration — it is
what lets the screen say "this expired" instead of sending a request that is guaranteed to 401 and
then showing an ambiguous message. `PendingTwoFactorChallenge` stores both. An unparseable
`expiresAt` is treated as "no client-side deadline" rather than as expired, so a malformed field
cannot lock a user out of a challenge the API would still accept.

## A segmented code input that moves focus re-enters its own focus handler with a stale value

**What:** the natural implementation of "advance to the next box on input" plus "if you focus a box
past the end of the code, bounce to the first empty one" deadlocks on the first keystroke. Typing
`1` in box 1 calls `onChange("1")` and then `boxes[1].focus()`. `focus()` dispatches synchronously,
**before React has applied the state update**, so the focus handler still sees `value === ""`, decides
box 1 is past the end, and bounces focus straight back to box 0. The first plan test —
"advances focus as digits are typed" — failed on exactly this, and it looks like a plain
off-by-one rather than a stale-closure problem.

**Evidence:** the first run of `code-input.test.tsx` reported focus on `Digit 1 of 6` (value `"1"`)
where `Digit 2 of 6` was expected. The fix is the `movingFocus` ref in
`features/auth/components/code-input.tsx`: set around the component's own `focus()` calls, and the
focus handler returns early while it is set.

**So what:** any input group that both drives focus and validates focus position needs this guard (or
must read the value from a ref rather than the prop). There is a second, non-obvious hole the guard
does *not* cover: clearing the value from outside — which the form does after a rejected code —
fires no focus event at all, so the caret is left in box 6 of an empty code. `write()` therefore also
clamps its write index to `value.length`, which makes the no-gaps invariant hold whatever the caret
is doing.

## `maxLength={1}` does not give you "the last typed character" — it drops the keystroke

**What:** the plan says "on change take the last typed character". With `maxLength={1}` and a box
that already holds a digit, the browser never delivers two characters: it refuses the input outright
and fires no `change` event. A user who mistypes one digit of six cannot fix it by typing over it —
they must delete first. Autofill is the mirror image: an authenticator or SMS suggestion can insert
all six characters into one box regardless of `maxLength`, because it is not a keystroke.

**Evidence:** `features/auth/components/code-input.tsx` — `focusBox` calls `select()` after `focus()`
so the next keystroke replaces the selection, and `write()` treats a multi-character value as digits
to spread across the following boxes rather than as one character to truncate.

**So what:** the two behaviours the plan describes ("last typed character", "fill all boxes on
paste") are one code path, not three, once you accept a multi-character input at any box. Paste is
handled explicitly as well: a paste carrying at least six digits replaces the whole code from box 1
however it was aimed, a shorter one inserts at the focused box, and non-digits are stripped so a
copied `"123 456"` or `"123-456"` still works.

## Deviations from the plan

**What:** four, all small.

1. **The plan's test uses `boxes[0]!`; biome forbids it** (`lint/style/noNonNullAssertion`, in the
   recommended set). `noUncheckedIndexedAccess` is off in `tsconfig.json`, so `boxes[0]` is already
   typed `HTMLElement` and the assertion was doing nothing. The three `!` were dropped; the tests are
   otherwise verbatim.
2. **`useTwoFactorChallenge` also calls `queryClient.clear()`**, before the invalidate the plan asks
   for. `useLogin` skips its own clear on the 2FA branch with the comment "that happens after the
   challenge succeeds" — this is that moment, and a shared back-office machine must not carry the
   previous person's cached tenant data into the new session. The `invalidateQueries` the plan
   specifies is kept, and matches nothing against the emptied cache; it is retained as the named
   contract, commented as such.
3. **`router.replace`, not `push`, after a successful challenge.** The challenge is spent, so leaving
   `/login/2fa` in the history gives Back a page that can only show the expired panel.
4. **The code row sits in the `AuthCard` 22px column, not the artboard's 24px.** `AuthCard` hardcodes
   `gap-[22px]` and is another task's file. The 2px is on the two gaps around the code row.

**Evidence:** `features/auth/hooks/use-two-factor-challenge.ts`,
`features/auth/components/two-factor-form.tsx`, `features/auth/components/auth-card.tsx`.

**So what:** if a screen ever needs the artboard's exact 24px, `AuthCard` should take the gap as a
prop rather than each caller wrapping it.

## What was not verified

**What:** the screen was never opened in a browser — Next 16's one-dev-server-per-directory lock
(see `task-02.md`) makes that unsafe with agents working in parallel, and the task forbade it. Layout
was checked by reading artboard `1f` at `docs/design/TradeOs-UI.dc.html:2740` rather than by
screenshot: 400px column, 36px Instrument Serif headline, six `flex:1` / 56px / 10px-radius boxes at
10px gap with centred 22px mono, 44px terracotta Verify, centred 13px `Back to sign in`. There is
only one 2FA artboard and it is the light one — the canvas draws no dark variant, so the dark
rendering is inferred from tokens.

`two-factor-form.tsx` also ships **untested**: the plan's file list for this task allows exactly one
spec, `code-input.test.tsx`. Its auto-submit, its double-submit guard and both expiry paths were
checked with a throwaway spec that was deleted afterwards, so nothing in the repo protects them now.

**So what:** whoever adds the `rememberTwoFactorChallenge` call to `login-form.tsx` should add
`features/auth/components/two-factor-form.test.tsx` in the same change — three cases: mutate is
called once on the sixth digit, a second attempt while one is in flight is refused, and a missing or
lapsed challenge renders "Sign in again" without touching the API.
