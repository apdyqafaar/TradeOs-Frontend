/**
 * The shape every feature's query keys take.
 *
 * Query keys are the invalidation contract: `invalidateQueries({ queryKey:
 * productKeys.lists })` has to reach every list variant, including ones a
 * different screen created with different filters. That only works if all of
 * them share a prefix, and a prefix only stays shared if nobody hand-writes
 * the array. This is a convention with a helper, not a framework — a feature
 * that needs a key this does not cover (`products.byBarcode(code)`) just adds
 * one alongside.
 */

/** Filters, pagination and sort as a plain object; `undefined` entries are dropped. */
export type QueryKeyParams = Record<string, unknown>;

export interface QueryKeys<Scope extends string> {
  /** Everything under the scope. Invalidate this after a write that could touch anything. */
  readonly all: readonly [Scope];
  /** Every list, whatever its filters. */
  readonly lists: readonly [Scope, "list"];
  list: (params?: QueryKeyParams) => readonly [Scope, "list", QueryKeyParams];
  /** Every detail, whatever its id. */
  readonly details: readonly [Scope, "detail"];
  detail: (id: string) => readonly [Scope, "detail", string];
}

/**
 * `undefined` and `null` are stripped so `{ page: 1, search: undefined }` and
 * `{ page: 1 }` hash to the same key. React Query serialises keys with stable
 * property ordering already, so only absent-vs-undefined needs handling here.
 */
const normalize = (params: QueryKeyParams | undefined): QueryKeyParams => {
  if (!params) return {};
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  return Object.fromEntries(entries);
};

export function createQueryKeys<const Scope extends string>(
  scope: Scope,
): QueryKeys<Scope> {
  return {
    all: [scope] as const,
    lists: [scope, "list"] as const,
    list: (params?: QueryKeyParams) =>
      [scope, "list", normalize(params)] as const,
    details: [scope, "detail"] as const,
    detail: (id: string) => [scope, "detail", id] as const,
  };
}
