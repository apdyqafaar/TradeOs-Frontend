# Task 6 — Accept invite

## The inviting business's name cannot be shown before accepting

**What:** Brief §6.1 specifies the headline `Join {Business name}` and "shows the inviter's business
name and the role". Neither is possible. The API exposes nothing about an invitation to an
unauthenticated caller: `POST /auth/accept-invite` is the *only* public invite route, it takes a
token and returns after the fact, and there is no `GET` that trades a token for the org name. Every
route that could name the business (`GET /members`, `GET /organizations/current`) is behind a
session and a permission. The name does reach the invitee — it is in the email that carried the
link — just not on the page.

**Evidence:** `docs/API-ROUTES.md:79` lists `POST /auth/accept-invite | public` as the single public
invite row; `:217–218` show both `/members/*invite*` routes gated on `members:invite` + verified
email. `Backend/src/routes/v1/auth.route.ts:79–82` mounts one accept-invite handler and no lookup.
`Backend/src/lib/mailer.ts:110–116` puts the org name in the email subject and body instead.

**So what:** The page renders the plan's `Join the team` headline with the subtitle "Set a name and a
password to finish accepting your invitation." Do not add a "fetch the invite details" service
function — the endpoint does not exist, and adding one would turn a public route into an oracle that
confirms whether a guessed token is live and which business it belongs to. If the owner wants the
name on the page, that is a backend change (a public `GET /auth/invite?token=` returning only the
org name), not a frontend one. The **role** is equally unavailable, for the same reason.

## An expired invite is `400 BAD_REQUEST`, and it means five different things

**What:** Every token failure mode answers identically: **status 400, `code: "BAD_REQUEST"`,
message "This invitation link is invalid or has expired"**. Unknown token, wrong token type, past
`expiresAt`, member row already active, and member/user mismatch all raise the same
`BadRequestError` — deliberately, so a public endpoint cannot be used to probe tokens. There is no
`INVITE_EXPIRED` code, and a 422 naming `token` means the same thing arrived malformed.

**Evidence:** `Backend/src/services/auth.service.ts:278` (`INVALID_INVITE`) and lines 312, 316, 320,
325, 335, 350 — six throw sites, one message. `Backend/src/util/errors.ts:32–36` — `BadRequestError`
defaults to `code: "BAD_REQUEST"`, status 400. Two failures do *not* use it: a banned or suspended
returning invitee gets a **403** (`auth.service.ts:360–363`) and a fresh invitee whose email already
has an account gets a **409** (`:406`).

**So what:** `accept-invite-form.tsx` branches on `API_ERROR_CODE.BAD_REQUEST` (plus a `token` field
error) to swap the form for the calm panel, and cannot distinguish "expired" from "already used" —
so the copy must not claim to. The 403 and 409 are real, specific and actionable, so they go to the
red `AuthErrorBanner` in the API's own words rather than being flattened into "expired".

## `proxy.ts` needs no edit for `/accept-invite` — and adding it to the wrong list breaks the flow

**What:** The plan's Step 3 says "Add `/accept-invite` to the proxy's public paths." There is no such
list. `proxy.ts` is a deny-list, not an allow-list: it redirects only paths inside
`APP_SHELL_PREFIXES` (when there is no cookie) and `GUEST_ONLY_PATHS` (when there is one).
`/accept-invite` is in neither, so it already falls through to `NextResponse.next()` with or without
a session.

**Evidence:** `proxy.ts:19–35` (the two lists) and `:43–58` (the two redirects, then `next()`).
Verified by reading; no proxy edit was made from this task, per the wave's file ownership.

**So what:** Whoever owns `proxy.ts` should leave it alone for this route. Specifically,
`/accept-invite` must **not** be added to `GUEST_ONLY_PATHS`: a returning invitee — someone who
already has a TradeOs account and is signed in on this browser — would be bounced to `/overview` and
could never accept, which is a supported backend path (`auth.service.ts:338–397` handles a member
row that already carries a `userId`).

## Accepting an invitation overwrites an existing account's name and password

**What:** For a *returning* invitee the submitted `name` and `password` are applied to the existing
account, not ignored: the password is re-hashed onto their credentials account, the user is renamed,
and **every one of their existing sessions is revoked** before the new one is issued. So the "Your
name" box on this page silently renames a real account, and the "Password" box is a password reset.

**Evidence:** `Backend/src/services/auth.service.ts:374–397` (`setAccountPassword`, `updateUser`
with `input.name`, `activateInvitedMember`) and `:442` (`if (returningUser) await
revokeAllSessions(...)`). The comment at `:285–304` explains this was a deliberate fix: previously
the password was accepted and discarded.

**So what:** The field labels are honest for the common case (a brand-new person) but under-explain
the returning one. The page cannot tell the two apart before submitting — it does not know the email
the token belongs to — so nothing is done about it here. If a "you have been signed out on your
other devices" surprise is ever reported, this is the cause, and the fix is copy on this page or a
distinguishing signal from the API, not a client change.

## `POST /auth/accept-invite` is rate-limited at 10 per 15 minutes

**What:** The route carries its own limiter, tighter than a normal endpoint, so a 429 on this page is
plausible rather than theoretical.

**Evidence:** `Backend/src/routes/v1/auth.route.ts:66` —
`rateLimit({ windowMs: 15 * 60_000, max: 10, name: "accept-invite" })`.

**So what:** The form maps `TOO_MANY_REQUESTS` to "Too many attempts — try again in a few minutes."
rather than falling through to the API's message. Anything that retries this mutation automatically
would burn the budget for a person who is trying to join once.
