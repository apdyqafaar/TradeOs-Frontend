import type { ObjectId } from "@/lib/api/types";

/**
 * Where the plain share token lives between being minted and being copied.
 *
 * **The token is returned exactly once, by the `publish` that mints it.** It is
 * 32 random bytes stored server-side only as a SHA-256 hash
 * (`lib/tokens.ts:4,11-12`, `project.model.ts:31`); no read endpoint returns
 * it, and `publish` on an already-hashed project answers `shareToken: null`
 * because the plain value was never stored anywhere
 * (`project.service.ts:333-338,348`). The only recovery is `regenerate-link`,
 * which invalidates every link already given to a client. So the value has to
 * survive at least as long as the person who just clicked Publish needs to copy
 * it — including a click through to another screen and back.
 *
 * **A plain module-level Map, and deliberately not `localStorage` or
 * `sessionStorage`.** The token is a bearer credential: anyone holding it can
 * read the project's public page. Writing it to disk-backed storage would leave
 * it readable by any later script on the origin and by the next person to use a
 * shared computer, for an indefinite period, in exchange for surviving a page
 * refresh. This trades that away: the value lives in the tab's heap, survives
 * client-side navigation within the app, and is gone on refresh or close. When
 * it is gone the UI says so plainly and offers `regenerate-link` with its cost
 * spelled out — which is a worse outcome for one person once, rather than a
 * secret sitting in storage forever.
 *
 * It is **cleared on unpublish**, because the link it holds has stopped working
 * (`project.actions.ts:130-131` filters on `isPublished: true`, with no cache
 * and no grace period). Keeping it would mean a Copy button handing a client a
 * URL that 404s — the "stale link" case this slice must never render.
 *
 * Not React state and not React Query: it is neither server state (the server
 * does not have it) nor state any single component owns (the publish happens in
 * the share card, and a later visit to the same project should still find it).
 */

const tokens = new Map<ObjectId, string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Subscribe to changes. The shape `useSyncExternalStore` wants. */
export function subscribeToShareTokens(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The token captured for this project in this tab, or `undefined`.
 *
 * `undefined` is not "there is no link" — the project may well be published
 * with a live link — it is "this browser cannot show it". The two read very
 * differently to a user and the share card keeps them apart.
 */
export function getShareToken(projectId: ObjectId): string | undefined {
  return tokens.get(projectId);
}

/**
 * Keep a freshly minted token.
 *
 * Called only from the publish and regenerate mutations, and only with a
 * non-null `shareToken`. A `null` from a re-publish must never reach here: it
 * would erase a token this tab may still be holding from the original publish,
 * which is the one copy of it that exists anywhere.
 */
export function rememberShareToken(projectId: ObjectId, token: string): void {
  if (tokens.get(projectId) === token) return;
  tokens.set(projectId, token);
  emit();
}

/** Drop it — on unpublish, and on deleting the project. */
export function forgetShareToken(projectId: ObjectId): void {
  if (!tokens.delete(projectId)) return;
  emit();
}

/** Test seam. Nothing in the app calls this. */
export function clearShareTokens(): void {
  if (tokens.size === 0) return;
  tokens.clear();
  emit();
}
