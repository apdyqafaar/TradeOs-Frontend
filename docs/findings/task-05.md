# Task 5 — verify email, forgot password, reset password

## An expired verification token and an already-used one are the same 400, with code `BAD_REQUEST`

**What:** `POST /auth/verify-email` has exactly one terminal failure shape. Expired, already spent,
mistyped, wrong token *type*, and issued-for-a-user-since-deleted all arrive as **HTTP 400** with
**`code: "BAD_REQUEST"`** and the message **"This link is invalid or has expired"**. There is no
`TOKEN_EXPIRED`, no `INVALID_TOKEN` code — `INVALID_TOKEN` in the backend is the name of a *message
constant*, not a code, which is easy to misread when grepping.

**Evidence:** `../Backend/src/services/auth.service.ts`:

- `:457` — `const INVALID_TOKEN = "This link is invalid or has expired";` (a message)
- `:512` — not found, or the type does not match → `throw new BadRequestError(INVALID_TOKEN)`
- `:514-517` — `expiresAt <= Date.now()` → the row is deleted, then the same throw
- `:604` — the user behind the token no longer exists → the same throw again
- `../Backend/src/util/errors.ts:32-36` — `BadRequestError` is `super(message, 400, code)` with
  `code` defaulting to `"BAD_REQUEST"`, and none of the four call sites passes one.

The comment at `:455` says the uniformity is deliberate: "Distinguishing them would tell a caller
more about a token they do not hold than a public endpoint should."

**So what:** two consequences.

1. The repo rule is "branch on `code`, never on `message`", and here there is no code specific enough
   to branch on. `verify-email-panel.tsx` therefore branches on **`error.status === 400`** and treats
   that as "dead link". Anything else — a 500, a 429, a dead network at status 0 — is deliberately
   *not* shown as an expired link, because sending someone to fetch a replacement link they do not
   need turns a transient failure into a permanent-looking one. `reset-password-form.tsx` does the
   same. If a screen ever needs to distinguish "expired" from "already used", the backend has to mint
   distinct codes first.
2. **A successful verification deletes the token** (`:610`), so *replaying a perfectly good link*
   produces a 400 indistinguishable from an expired one. That is exactly what React strict mode's
   double effect invocation does in development, and why `VerifyEmailPanel` guards `mutate` with a
   `useRef(false)` rather than relying on the mutation's own idempotence — there is none.

`POST /auth/reset-password` shares `readValidToken` and therefore behaves identically (`:534`).

## `proxy.ts` is a deny-list. There is no public-paths list and adding one would be worse

**What:** the plan (Task 5 step 4, Task 6 step 3) says to "add `/verify-email` … to the paths the
proxy allows without a session cookie", which reads as though an allow-list exists. It does not.
`proxy()` redirects in exactly two cases — no cookie *and* inside `APP_SHELL_PREFIXES`, or a cookie
*and* an exact match in `GUEST_ONLY_PATHS` — and returns `NextResponse.next()` for everything else.

**Evidence:** `proxy.ts:84-98`. `/verify-email`, `/forgot-password`, `/reset-password`,
`/accept-invite` and `/onboarding` appear in neither array, so all five already fell through in both
the signed-in and signed-out states before this task. The matcher regex is an *exclusion* list for
paths that should not pay for the proxy at all (`_next`, the rewritten API, file extensions,
`/p/:token`), not a route allow-list.

I first implemented a third `SESSION_OPTIONAL_PREFIXES` array with an early `next()`. It was
behaviour-identical and I reverted it: an array that changes nothing reads like a gate, and the next
person would conclude a page must be listed to be reachable. **The final diff to `proxy.ts` is
comment-only** — verified with `git diff proxy.ts`, which shows no change outside comment lines.

**So what:** a new public page needs no proxy entry. What it needs is to stay *out* of both arrays,
and that is what the comment now on `GUEST_ONLY_PATHS` records.

## Five paths must never become guest-only, and two of them have signed-in callers by design

**What:** the tempting mistake is to treat every `(auth)` route as guest-only. Two of these have a
first-class signed-in caller, not an edge case:

- **`/verify-email`** — the *ordinary* case is signed in. Registration sets the session cookie before
  it answers, so someone who registered on this laptop and clicked the link in the same browser
  arrives with a cookie. A guest-only bounce to `/overview` swallows the token and leaves the address
  unverified with nothing on screen explaining why `POST /organizations` keeps refusing.
- **`/accept-invite`** — a **returning invitee** already has a TradeOs account and is being invited to
  a second business. `../Backend/src/services/auth.service.ts:330-397` handles that branch explicitly
  (`returningUser`: sets the password, applies the name, activates the membership). Guest-only means
  they can never accept an invitation. Found by the Task 6 agent; recorded here because this file owns
  the proxy edit.
- **`/onboarding`** — `components/layout/route-guard.tsx:36` redirects a signed-in user with
  `organization: null` out of the shell to `/onboarding`. Guest-only would make that a loop:
  `/overview` → guard → `/onboarding` → proxy → `/overview`.
- **`/forgot-password`, `/reset-password`** — signed in on a phone and locked out on a laptop is one
  person with one account, and the reset revokes every session anyway.

**Evidence:** `proxy.ts:42-73` now carries all five with their reasons.

**So what:** the comment is the whole deliverable of the proxy half of this task. It costs nothing at
runtime and is the only thing standing between a future tidy-up and a broken invitation flow.

## `/onboarding` for a signed-out visitor: confirmed correct as-is, not an omission

**What:** the brief asked me to "allow `/onboarding` for a signed-out visitor to reach the page rather
than 401 blindly". It already does, because it is in neither array. Checked both states:

| | signed out | signed in |
|---|---|---|
| proxy | falls through, page renders | falls through, page renders |
| then | `GET /auth/me` 401s → api client redirects to `/login?next=/onboarding` | wizard renders |

**Evidence:** `proxy.ts:84-97`; `lib/api/client.ts:233-241` — `ANONYMOUS_ROUTES` does **not** contain
`/onboarding`, which is what makes that 401 produce a redirect rather than a silent failure. It
*does* contain `/verify-email`, `/forgot-password`, `/reset-password` and `/accept-invite`, so a 401
on those pages is absorbed. This is the redirect `docs/findings/task-07.md` described; nothing was
changed, only documented.

**So what:** the signed-out path costs one visible redirect instead of a proxy-absorbed one. That is
the documented optimistic posture, and making the proxy absorb it would mean treating `/onboarding`
as app shell — which would then bounce the signed-in-but-tenantless user the guard is trying to send
there.

## `**/verify-email**` inside a JSDoc block silently ends the comment

**What:** writing a markdown-bolded path in a block comment — `- **/verify-email**` — contains the
sequence `*/`, which closes the comment. The rest of the "comment" is parsed as code.

**Evidence:** `bunx tsc --noEmit` produced 40+ cascading errors in `proxy.ts`, starting
`proxy.ts(51,24): error TS1127: Invalid character.` — for a file whose only edit was comments. The
fix was `` `/verify-email` `` (backticks) instead of `**/verify-email**`.

**So what:** this codebase's comments are long and markdown-flavoured, and every auth path starts with
a slash. Bold a path with backticks, never with `**`. The error message points at the *character*,
not at the comment, so the cause is not obvious from the output.

## Next 16 Proxy: the matcher is unchanged from Middleware; the runtime default is not

**What:** I checked the proxy docs for matcher-syntax differences, as briefed. **There are none** —
the `matcher` contract (string, array, object with `source`/`has`/`missing`/`locale`, path-to-regexp
patterns, must be statically analysable) is identical to Middleware's. The rename is the file name and
the exported function name and nothing else; the official codemod
(`npx @next/codemod@canary middleware-to-proxy .`) does exactly those two renames.

The one real behavioural change in v16 is in the version-history table and easy to miss:
**"Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime."** It used to
be the Edge runtime.

**Evidence:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` —
matcher section at `:71-131`, migration at `:769-801`, version table at `:802-813`.

Two matcher facts worth keeping, both unchanged but both load-bearing here:
- Values "need to be constants so they can be statically analyzed at build-time. Dynamic values such
  as variables will be ignored" — *ignored*, not an error. A matcher built from `ROUTES` would
  silently become no matcher at all.
- With no matcher, Proxy runs on **every** request including `_next/static` and `public/` assets.

**So what:** nothing in this task needed a matcher change. But the Node.js default means proxy code
can now reach for `fs` or `crypto` and it will compile — which makes the "never fetch, never decode"
rule easier to break by accident than it was under Edge, where the runtime refused.

## Three screens whose headline is part of their state, so the component owns the `AuthCard`

**What:** `AuthCard` takes `headline`/`subtitle` as props and holds no state, so a page that renders
`<AuthCard headline="…"><Form /></AuthCard>` (the shape `login/page.tsx` uses) cannot change the
headline when the form is replaced by its confirmation. All three screens here do exactly that —
forgot-password → "Check your email", verify-email → four different headlines, reset-password →
"That link has expired". So each component renders its own `AuthCard` and the page is metadata plus
one element.

**Evidence:** `features/auth/components/{forgot-password-form,reset-password-form,verify-email-panel}.tsx`;
`app/(auth)/{forgot-password,reset-password,verify-email}/page.tsx`.

**So what:** `AuthCard` has no `"use client"` and no hooks, so importing it into a client component
just pulls ~40 lines across the boundary — there is no server-only cost being lost. If a later screen
has a genuinely fixed headline, keep the card in the page as login does; both shapes are correct and
the deciding question is whether the headline changes.

## `searchParams` is a Promise in Next 16, and awaiting it avoids the Suspense boundary Task 2 warned about

**What:** `docs/findings/task-02.md` warns that every page reading `?token=` needs a `<Suspense>`
boundary, because `useSearchParams()` forces a client bailout. That is true for the *hook*. Reading
`searchParams` on the Server Component page instead needs no boundary — the page is simply dynamic,
which it would be anyway since its whole content depends on the query string. The prop is a
**Promise** and must be awaited.

**Evidence:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md:67-85`.
`app/(auth)/verify-email/page.tsx` and `reset-password/page.tsx` both do
`const token = firstValue((await searchParams).token)` and pass it down as a plain prop; neither has a
boundary and `bunx tsc --noEmit` is clean.

**So what:** for `?token=` pages prefer the server read — no boundary, no fallback height to guess, and
the token never enters the client hook graph. `accept-invite` can use the same shape. Note
`searchParams` values are `string | string[] | undefined`: `?token=a&token=b` yields an array, so both
pages take the first element rather than passing an array where a string is typed.

## Decisions the plan was silent on

**What:** five choices, recorded so they are not read as accidents.

1. **The reset form's confirm-password schema is local to the component.** The plan asks for "new
   password + confirm with a `.refine` equality check", but `features/auth/schemas/auth.schema.ts`
   was not in this task's file list (another agent's lane) and `resetPasswordSchema` there correctly
   mirrors the *API body*, `{ token, password }`. The second box is a client-only concern, so
   `resetPasswordFormSchema` lives in `reset-password-form.tsx`. Its 8–128 bounds and messages are
   copied verbatim from the shared `password` rule so the two cannot drift apart in wording.
2. **A 429 is not shown in the banner** on either form. `lib/api/client.ts` already toasts the
   limiter's own sentence, and a banner repeating it is the same complaint twice. Worth knowing that
   both endpoints are limited tightly: 5 per hour for forgot-password and for resend-verification
   (`../Backend/src/routes/v1/auth.route.ts:64-65`).
3. **`useResetPassword` calls `queryClient.clear()`, not `invalidateQueries`.** The endpoint revokes
   every session on the account including the caller's, so anything cached was read as an identity
   that no longer has a cookie; invalidating would keep it on screen while the refetch 401s.
4. **The verify-email spinner is `<output>`, not `<div role="status">`.** biome's
   `lint/a11y/useSemanticElements` rejects the hand-written role, and `<output>` carries
   `role="status"` and a polite live region implicitly.
5. **The dead-link panel renders neither action while `useSession()` is pending**, reserving the
   button's height instead. Guessing "signed out" and then swapping in a Resend would let someone
   click an option that vanishes under the cursor.

## What I could not verify

**What:** no browser check. The brief forbids starting a dev server (Next 16 locks per project
directory — see `docs/findings/task-02.md`) and another agent's server holds this directory, so I did
not run `bun run build` either: it writes the same `.next` a live `next dev` is holding.

So the following are argued from source and types, not observed: the 400 → dead-link branch against a
real expired token; the strict-mode double-mount guard under an actual React dev double-invocation;
and the three screens' pixel agreement with artboard `1f`'s conventions. Everything asserted about the
API's behaviour is read directly from the backend source, cited above. `bunx tsc --noEmit` is clean,
`bunx biome check` is clean over these files, and `bunx vitest run` is 102/102 across 18 files.
