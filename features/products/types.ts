import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * Re-states a type's own properties as an object literal type.
 *
 * Needed because the two params types below are React Query key inputs, and
 * `createQueryKeys(...).list()` takes `QueryKeyParams = Record<string, unknown>`
 * — which an `interface` is **not** assignable to. TypeScript gives an implicit
 * index signature to object *type aliases* and to mapped types, but never to an
 * interface, since an interface can be reopened by a later declaration. So
 * `interface ProductListParams extends PaginationParams` (the shape the
 * scaffolder's template generates) fails to compile at the key call site.
 *
 * Mapping keeps `PaginationParams` as the single source of truth for `page` and
 * `limit` rather than copying the two fields into every feature.
 */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * The wire shapes of the eight `/products` endpoints.
 *
 * Transcribed field for field from `publicProduct` and `publicMovement` in
 * `../Backend/src/controller/product.controller.ts` — the shapers, not the
 * Mongoose models. No raw document reaches the wire: `organizationId`,
 * `searchName`, `createdBy` (on the product), `__v` and `updatedAt` (on a
 * movement) exist in the database and are absent here because the shaper drops
 * them. Ids are `id`, never `_id`, and nested references are `.toString()`'d
 * strings.
 *
 * Dates arrive as ISO 8601 **strings**. Typing one as `Date` compiles and then
 * fails on `.getTime()` — JSON has no date type and nothing here revives one.
 * Feed them to `formatDate(iso, timezone)` with the business timezone.
 */

/**
 * The product's category, resolved to a name by the controller so a table can
 * render it without a second request.
 *
 * `null` does **not** mean "uncategorised" — every product has a category, and
 * one created without a `categoryId` gets the seeded **General**. `null` here
 * means the record is malformed: its category row is gone. Render it as a
 * muted dash, not as an empty select.
 */
export interface ProductCategoryRef {
  id: ObjectId;
  name: string;
}

/**
 * A denormalised copy of an attached upload's public URLs. `uploadId` is the
 * id `<ImagePicker>` works in; `url` and `thumbUrl` are ready to render, and
 * reads never join back to the Upload collection to get them.
 */
export interface ProductImage {
  uploadId: ObjectId;
  url: string;
  thumbUrl: string;
}

/** Archiving is not deleting (brief §9). `DELETE /products/:id` sets this. */
export type ProductStatus = "active" | "archived";

export interface Product {
  id: ObjectId;
  name: string;
  /** Optional and unique per business when present. */
  barcode?: string;
  category: ProductCategoryRef | null;
  /** Free text, max 20 — `pcs`, `kg`, `carton`. Defaults to `pcs` on create. */
  unit: string;
  /** Main-currency amounts, 2 dp. Format with `formatMoney(value, currency)`. */
  costPrice: number;
  sellingPrice: number;
  /**
   * `false` means a service or a fee. Such a product has no stock at all — its
   * `quantity` is a frozen number the API refuses to move (409
   * `STOCK_NOT_TRACKED`), so the stock card, the low-stock badge and the
   * movements table must be **absent**, not zero.
   */
  trackStock: boolean;
  /** Up to 3 dp — goods are sold by weight. `formatQuantity(value, unit)`. */
  quantity: number;
  /**
   * Absent when the business set no alarm. A tracked product with no threshold
   * can never be "low" — and never appears in the `lowStock=true` list, at any
   * quantity, because the backend's filter requires the field to be set.
   */
  lowStockThreshold?: number;
  description?: string;
  /** Max 5, in display order. Empty array, never absent. */
  images: ProductImage[];
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The four ways `Product.quantity` can move. Only two of them can be sent:
 * `restock` and `adjustment` (see `stockMovementSchema`). `sale` and
 * `sale_void` are written by the API when a sale is recorded or voided, and
 * appear here only because the movements table renders them.
 */
export type StockMovementType = "sale" | "sale_void" | "restock" | "adjustment";

/**
 * One row per change to a product's quantity, written in the same transaction
 * as the change. There is no other path that moves stock.
 *
 * Note what is **not** here. `createdBy` is a bare **member id string**, not a
 * `{ id, name }` object — `publicMovement` does `movement.createdBy.toString()`
 * — so the "Who" column cannot render a name from this payload alone; it needs
 * `GET /members` (gated on `members:view`, which every preset role holds) to
 * resolve ids to names. And there is no `updatedAt`: movements are immutable,
 * so the shaper omits it even though the collection stores one.
 */
export interface StockMovement {
  id: ObjectId;
  productId: ObjectId;
  type: StockMovementType;
  /** The **signed delta**: sale negative, restock positive, adjustment either. */
  quantity: number;
  /** The product's quantity after this movement — what the audit trail proves. */
  quantityAfter: number;
  /** Present on `sale` and `sale_void` only; links the row to its receipt. */
  saleId?: ObjectId;
  /** Required for an adjustment, optional for a restock, absent on a sale. */
  reason?: string;
  /** A member id. See the note above — this is not a name. */
  createdBy: ObjectId;
  createdAt: string;
}

/** What `POST /products/:id/stock` answers with: both halves of the write. */
export interface StockAdjustmentResult {
  /** The product AFTER the movement — seeded straight into the detail cache. */
  product: Product;
  /** The row that was appended to the movements table. */
  movement: StockMovement;
}

/**
 * Everything `GET /products` accepts.
 *
 * Flat and scalar-only on purpose: this exact object is what `nuqs` keeps in
 * the query string and what React Query hashes into the key. The query schema
 * on the backend is `.strict()`, so an unknown key here is a 422 rather than a
 * quietly ignored filter — `product.service.ts` is what serialises these, and
 * it is the only place that knows `lowStock` goes on the wire as the string
 * `"true"` or not at all.
 */
export type ProductListParams = Flat<
  PaginationParams & {
    /**
     * A **prefix** match on the name, OR an exact barcode match — one field, two
     * behaviours (`buildFilter` in the backend's product.actions.ts). Searching
     * "rice" will not find "Basmati rice"; a scanned barcode will find its
     * product exactly.
     */
    search?: string;
    /** Defaults to `"active"` server-side, so archived rows are hidden unless asked for. */
    status?: "active" | "archived" | "all";
    categoryId?: ObjectId;
    /**
     * Tracked products at or below their threshold. Products with no threshold
     * set are excluded entirely, however empty they are.
     */
    lowStock?: boolean;
  }
>;

/** `GET /products/:id/stock-movements` takes pagination and nothing else. */
export type StockMovementListParams = Flat<PaginationParams>;
