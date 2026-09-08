import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { ProductListParams, StockMovementListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two strings that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the list simply keeps
 * showing the row you just changed until the next hard reload.
 *
 * `createQueryKeys("products")` covers lists and details. This slice adds two
 * branches it does not cover, both under the same `["products"]` prefix so
 * `invalidateQueries({ queryKey: productKeys.all })` still reaches everything:
 * the barcode lookup the counter scans with, and a product's stock movements.
 *
 * `lists` and `details` on `createQueryKeys` are readonly tuples, not
 * functions — they are wrapped as functions here only so every member of this
 * object is called the same way at the use site. (The scaffolder's
 * `keys.ts.template` writes `keys.lists()` and does not compile; see
 * `docs/findings/s2-task-01.md`.)
 */
const keys = createQueryKeys("products");

export const productKeys = {
  /**
   * Everything this slice caches. The blunt instrument — reach for a narrower
   * key first, because invalidating `all` also throws away detail entries that
   * are still correct and refetches them on the next render.
   */
  all: keys.all,

  /**
   * Every list, at any page, under any filter. What a create or an archive
   * invalidates: both change which rows land on which page and both change
   * `meta.total`, so no cached page can be patched to match.
   */
  lists: () => keys.lists,

  /** One list. `params` is part of the key — hence `ProductListParams` being flat. */
  list: (params: ProductListParams) => keys.list(params),

  /** Every detail entry. */
  details: () => keys.details,

  /** One product. Seeded from a mutation response, read by the detail page. */
  detail: (id: ObjectId) => keys.detail(id),

  /**
   * Every barcode lookup. Its own branch rather than a `list` variant, because
   * `GET /products/barcode/:code` returns a single product and — unlike the
   * list — only ever an **active** one, so an archived product 404s here while
   * still being fetchable by id.
   *
   * Any write invalidates this: a scan cached during a shift would otherwise
   * keep showing the price and quantity the product had when it was first
   * scanned.
   */
  barcodes: () => ["products", "barcode"] as const,
  byBarcode: (code: string) => ["products", "barcode", code] as const,

  /**
   * A product's stock movements. Under `["products", "movements", id]` rather
   * than beneath `detail(id)` deliberately: the two are invalidated for
   * different reasons and at different times, and nesting them would make
   * every detail refetch drag a page of movements along with it.
   */
  movements: (productId: ObjectId) =>
    ["products", "movements", productId] as const,
  movementList: (productId: ObjectId, params: StockMovementListParams) =>
    ["products", "movements", productId, params] as const,
} as const;
