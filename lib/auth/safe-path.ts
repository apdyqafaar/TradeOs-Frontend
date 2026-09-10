/**
 * Is this value a path inside this app, rather than somewhere else entirely?
 *
 * The `next=` parameter is the one piece of routing an attacker gets to write.
 * It is minted by `proxy.ts` and by `app/(app)/layout.tsx` for the honest case
 * — "you were aiming at `/sales?page=2`, come back here after signing in" —
 * but nothing stops a stranger sending someone a link with their own value in
 * it. Handed to `router.push()` unchecked, `?next=//evil.example` navigates
 * off-origin from a page the user reached by typing this product's own domain,
 * which is the shape a credential-phishing link wants.
 *
 * **A module of its own, importing nothing, on purpose.** Both ends need it:
 * `lib/auth/server-session.ts` (which pulls in `next/headers` and so can never
 * be imported by a client component) and `features/auth/components/login-form.tsx`
 * (a client component). One copy means the two cannot drift into disagreeing
 * about what "safe" is — which is the failure mode that makes a second copy
 * worse than none.
 */
export const isSafeInternalPath = (value: string): boolean =>
  value.startsWith("/") &&
  // `//evil.example` is protocol-relative — the browser supplies the scheme
  // and leaves the origin. `/\evil.example` is normalised to it by several
  // browsers, so it leaves too, despite looking like a path.
  !value.startsWith("//") &&
  !value.startsWith("/\\");
