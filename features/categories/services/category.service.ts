import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/features/categories/schemas/category.schema";
import type { Category } from "@/features/categories/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";

/**
 * The four category rows of `docs/API-ROUTES.md` this slice uses, gated on
 * `categories:view` / `create` / `update` / `delete`.
 *
 * `GET /categories/:id` is the fifth row and is deliberately **not** wrapped:
 * the list returns every field a single fetch would, including `productCount`,
 * and nothing in this slice or the products slice reads one category by id —
 * a product carries its own `{ id, name }` reference. Add it when something
 * needs it rather than shipping an untested path.
 */

/**
 * `GET /categories` — **a bare array, not a page.**
 *
 * `apiGet`, not `apiGetList`: the controller calls `successResponse` with no
 * `meta` argument (`Backend/src/controller/category.controller.ts:28-32`), so
 * there is no pagination envelope to unwrap. The list is the organization's
 * whole set, sorted by name server-side.
 */
export const listCategories = (): Promise<Category[]> =>
  apiGet<Category[]>("/categories");

/** `POST /categories` — 409 `CATEGORY_EXISTS` when the name is already taken. */
export const createCategory = (input: CreateCategoryInput): Promise<Category> =>
  apiPost<Category>("/categories", input);

/**
 * `PATCH /categories/:id` — 409 `CATEGORY_EXISTS` when the new name collides
 * with another category's, case-insensitively. Renaming the protected General
 * category is allowed: it is looked up by `key`, never by name.
 */
export const updateCategory = (
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> => apiPatch<Category>(`/categories/${id}`, input);

/**
 * `DELETE /categories/:id` — a hard delete, and refused in two cases:
 * 409 `CATEGORY_PROTECTED` for General, and 409 `CATEGORY_IN_USE` (with
 * `details.productCount`) while any product still points at it.
 *
 * No body: the route validates against `noBodySchema`.
 */
export const deleteCategory = (id: string): Promise<void> =>
  apiDelete<void>(`/categories/${id}`);
