"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { categoryKeys } from "@/features/categories/keys";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/features/categories/schemas/category.schema";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/features/categories/services/category.service";
import type { Category } from "@/features/categories/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * All three writes invalidate `categoryKeys.lists` and nothing else. There is
 * no detail query in this slice to keep in step (see the service), and the
 * list is one small request, so a refetch is cheaper than reasoning about
 * which row of a cached array to patch.
 *
 * **What they deliberately do not invalidate: the products list.** A product
 * row carries `category: { id, name }`, so renaming a category leaves the old
 * name on any product page already in the cache until it refetches on its
 * own. Reaching into `features/products` from here would couple two slices
 * through their query keys in the direction that makes both harder to move;
 * the products slice invalidating its own lists after a rename is the fix if
 * it ever matters visibly. Recorded in `docs/findings/s2-task-02.md`.
 */
const useInvalidateCategoryLists = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: categoryKeys.lists });
  };
};

/** `POST /categories`. A taken name comes back as 409 `CATEGORY_EXISTS`. */
export function useCreateCategory(): UseMutationResult<
  Category,
  ApiError,
  CreateCategoryInput
> {
  const invalidate = useInvalidateCategoryLists();

  return useMutation<Category, ApiError, CreateCategoryInput>({
    mutationFn: createCategory,
    onSuccess: invalidate,
  });
}

/** The variables a rename (or a description edit) is sent with. */
export interface UpdateCategoryVariables {
  id: string;
  input: UpdateCategoryInput;
}

/**
 * `PATCH /categories/:id`.
 *
 * `{ id, input }` rather than a flattened object so `input` stays exactly the
 * body the API validates — including `description: null`, which *clears* the
 * description where an omitted key leaves it alone.
 */
export function useUpdateCategory(): UseMutationResult<
  Category,
  ApiError,
  UpdateCategoryVariables
> {
  const invalidate = useInvalidateCategoryLists();

  return useMutation<Category, ApiError, UpdateCategoryVariables>({
    mutationFn: ({ id, input }) => updateCategory(id, input),
    onSuccess: invalidate,
  });
}

/**
 * `DELETE /categories/:id`, taking the id as its variable.
 *
 * The id is the mutation variable rather than a hook argument on purpose: one
 * mutation instance serves the whole list, and `mutation.variables` is then
 * the id of the row that failed — which is how `<CategoryTab />` puts a
 * refused delete on the right row instead of in a toast.
 */
export function useDeleteCategory(): UseMutationResult<void, ApiError, string> {
  const invalidate = useInvalidateCategoryLists();

  return useMutation<void, ApiError, string>({
    mutationFn: deleteCategory,
    onSuccess: invalidate,
  });
}
