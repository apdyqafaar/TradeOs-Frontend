/**
 * What a dead share link renders.
 *
 * **Every failure lands here and they are deliberately indistinguishable**: a
 * mistyped token, an unpublished project, a link that was regenerated, a
 * deleted project, a rate limit, a backend that is down. That is not
 * laziness — the API goes out of its way to answer identically across a wrong
 * token, a malformed one and a never-issued one (`toEqual` on the whole body,
 * `public-link.test.ts:168-191`), and a page that said "this project was
 * unpublished" for one and "not found" for another would hand a prober the
 * oracle the backend removed. A token over 128 characters is even a **422**
 * rather than a 404 (contract §3.7), so branching on status would branch wrong
 * as well as leak.
 *
 * **Not an error card, and not the app shell.** The reader is a client of a
 * business, not a user of this product: they have no account, no session and no
 * idea what TradeOs is. So there is no retry button (nothing here is retryable
 * by them), no request id (it means nothing to them and belongs to the business
 * whose page this is), no sign-in link, and no navigation into an app they
 * cannot enter. One sentence, and what to do about it — which is to ask the
 * person who sent the link.
 *
 * A Server Component with no client boundary. It is HTML.
 */
export function PublicLinkUnavailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="font-serif text-[28px] text-foreground leading-[1.15]">
        This link is not available
      </h1>
      <p className="text-[14px] text-muted-foreground leading-[1.6] text-pretty">
        It may have been turned off or replaced with a newer one. Ask whoever
        sent it to you for the current link.
      </p>
      <p className="pt-6 font-mono text-[11px] text-muted-3">
        Shared via TradeOs
      </p>
    </main>
  );
}
