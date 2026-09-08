/**
 * The wire shape of a category, straight off `publicCategory` in
 * `Backend/src/controller/category.controller.ts:8-16`. Nothing is reshaped
 * on the way in: `GET /categories` answers a **bare array** of these — no
 * pagination envelope, no `{ category, productCount }` wrapper — because
 * `listCategories` calls `successResponse(res, …, categories.map(publicCategory))`
 * with no `meta` argument.
 */
export interface Category {
  id: string;
  /** 1–60 characters. Unique per organization, case-insensitively. */
  name: string;
  /**
   * Up to 200 characters. Absent rather than `null` when cleared — the API
   * `$unset`s it (`Backend/src/services/category.service.ts:84-87`), so the
   * document looks like one that never had a description.
   */
  description?: string;
  /**
   * **Not "this is the protected one".** Read the comment on
   * `ICategory.isDefault` (`Backend/src/db/models/category.model.ts:20`):
   * "True for the four seeded on organization creation; informational only."
   * A fresh organization has four — General, Food & Drinks, Household and
   * Electronics — and three of them are ordinary, deletable categories.
   *
   * The one category DELETE actually refuses (409 `CATEGORY_PROTECTED`) is
   * the one carrying `key: "general"`, and **`key` is not on the wire**. So
   * no client can tell the protected category from the other three seeded
   * ones. `<CategoryTab />` gates its delete button on `isDefault` anyway,
   * per the plan, and handles `CATEGORY_PROTECTED` inline in case the guess
   * is wrong — see `docs/findings/s2-task-02.md`.
   *
   * The same trap applies to picking "the default category" for a product
   * form: `categories.find((c) => c.isDefault)` on a list sorted by name
   * returns **Electronics**, not General. Omitting `categoryId` on
   * `POST /products` is the only reliable way to land in General.
   */
  isDefault: boolean;
  /**
   * Products of any status pointing at this category, counted server-side in
   * one aggregate for the whole list. It is what makes a delete an informed
   * one: a category with products cannot be deleted (409 `CATEGORY_IN_USE`).
   */
  productCount: number;
  /** ISO 8601 strings, not `Date`. */
  createdAt: string;
  updatedAt: string;
}
