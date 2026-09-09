import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { DebtListParams, PaymentListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — a debt screen just keeps
 * showing the balance from before the payment. On a feature about money owed,
 * that is the failure mode that costs trust, so nothing here is hand-written at
 * a call site.
 *
 * `createQueryKeys("debts")` covers lists and details. This slice adds one
 * branch it does not cover — a debt's payments — under the same `["debts"]`
 * prefix, so `invalidateQueries({ queryKey: debtKeys.all })` still reaches
 * everything.
 *
 * `lists` and `details` on `createQueryKeys` are readonly tuples, **not
 * functions** (`lib/query/keys.ts:19-23`); they are wrapped as functions here
 * only so every member of this object is called the same way at the use site.
 * The scaffolder's `keys.ts.template` writes `keys.lists()` against the raw
 * helper and does not compile — see `docs/findings/s2-task-01.md`.
 */
const keys = createQueryKeys("debts");

export const debtKeys = {
  /**
   * Everything this slice caches. The blunt instrument — reach for a narrower
   * key first, because invalidating `all` also discards detail and payment
   * entries that are still correct.
   */
  all: keys.all,

  /**
   * Every list, at any page, under any filter. What a create, a payment, a
   * write-off and a void all invalidate: each changes `remaining` or `status`,
   * and both are filter inputs, so a row can move between the `open`,
   * `overdue`, `paid` and `written_off` pages and change `meta.total` on each.
   * No cached page can be patched to match.
   */
  lists: () => keys.lists,

  /** One list. `params` is hashed into the key — hence `DebtListParams` being flat. */
  list: (params: DebtListParams) => keys.list({ ...params }),

  /** Every detail entry. */
  details: () => keys.details,

  /** One debt. Seeded from a write-off response, read by the detail screen. */
  detail: (id: ObjectId) => keys.detail(id),

  /**
   * A debt's payments, all pages. Under `["debts", "payments", id]` rather than
   * beneath `detail(id)` deliberately: the two are invalidated for different
   * reasons — a write-off moves the debt and adds no payment — and nesting them
   * would make every debt refetch drag a page of payments along with it.
   */
  payments: (debtId: ObjectId) => ["debts", "payments", debtId] as const,

  /** One page of one debt's payments. */
  paymentList: (debtId: ObjectId, params: PaymentListParams) =>
    ["debts", "payments", debtId, params] as const,
} as const;
