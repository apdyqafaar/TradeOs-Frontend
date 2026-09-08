import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import type { Permission } from "@/lib/auth/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { CategoryTab } from "./category-tab";

const categories = vi.fn();
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: () => categories(),
}));

const createMutation = vi.fn();
const updateMutation = vi.fn();
const deleteMutation = vi.fn();
vi.mock("@/features/categories/hooks/use-category-mutations", () => ({
  useCreateCategory: () => createMutation(),
  useUpdateCategory: () => updateMutation(),
  useDeleteCategory: () => deleteMutation(),
}));

/**
 * The plan mocks this as `useCan: () => true`. A spy instead, so the one test
 * that asks what a member without `categories:delete` sees can answer it —
 * the repo's rule is that such a member sees no control at all, and a
 * hard-coded `true` cannot check that.
 */
const can = vi.fn<(permission: Permission) => boolean>();
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (permission: Permission) => can(permission),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const mutate = vi.fn();

beforeEach(() => {
  can.mockReset();
  can.mockReturnValue(true);
  mutate.mockReset();
  createMutation.mockReturnValue({ mutate, isPending: false, error: null });
  updateMutation.mockReturnValue({ mutate, isPending: false, error: null });
  deleteMutation.mockReturnValue({ mutate, isPending: false, error: null });
});

describe("CategoryTab", () => {
  it("marks the default category protected and offers no delete for it", () => {
    // `isDefault` is the wire field, not `key: "general"`. General is the
    // fallback for every product created without a category, so deleting it
    // is refused by the API with 409 CATEGORY_PROTECTED.
    categories.mockReturnValue({
      isPending: false,
      error: null,
      data: [
        { id: "c1", name: "General", isDefault: true, productCount: 12 },
        { id: "c2", name: "Electronics", isDefault: false, productCount: 3 },
      ],
    });

    render(wrap(<CategoryTab />));

    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /delete/i })).toHaveLength(1);
  });

  it("shows how many products hold each category, so a delete is an informed one", () => {
    categories.mockReturnValue({
      isPending: false,
      error: null,
      data: [
        { id: "c2", name: "Electronics", isDefault: false, productCount: 3 },
      ],
    });

    render(wrap(<CategoryTab />));
    expect(screen.getByText(/3 products/i)).toBeInTheDocument();
  });

  it("puts a refused delete on the row that refused it, with the count", async () => {
    // CATEGORY_IN_USE means real products point at this category. The row is
    // where the product count is, so the row is where the refusal belongs —
    // a toast would take the number away from the thing it is about.
    categories.mockReturnValue({
      isPending: false,
      error: null,
      data: [
        { id: "c1", name: "General", isDefault: true, productCount: 12 },
        { id: "c2", name: "Electronics", isDefault: false, productCount: 3 },
      ],
    });
    deleteMutation.mockReturnValue({
      mutate,
      isPending: false,
      variables: "c2",
      error: new ApiError({
        message: "This category is still used by products.",
        status: 409,
        code: API_ERROR_CODE.CATEGORY_IN_USE,
        details: { productCount: 3 },
      }),
    });

    render(wrap(<CategoryTab />));

    const note = await screen.findByText(/in use by 3 products/i);
    expect(note).toBeInTheDocument();
    // Attached to Electronics' row, not floating above the list.
    expect(note.closest("li")).toHaveTextContent("Electronics");
  });

  it("hides every write control from a member who may only look", () => {
    can.mockImplementation(
      (permission) => permission === PERMISSIONS.CATEGORIES_VIEW,
    );
    categories.mockReturnValue({
      isPending: false,
      error: null,
      data: [
        { id: "c2", name: "Electronics", isDefault: false, productCount: 0 },
      ],
    });

    render(wrap(<CategoryTab />));

    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /rename/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/new category name/i),
    ).not.toBeInTheDocument();
  });

  it("refuses an empty name in the browser rather than spending a round trip on it", async () => {
    categories.mockReturnValue({ isPending: false, error: null, data: [] });

    render(wrap(<CategoryTab />));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(/category name is required/i),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends a trimmed name and clears the box on success", async () => {
    categories.mockReturnValue({ isPending: false, error: null, data: [] });
    mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );

    render(wrap(<CategoryTab />));
    const box = screen.getByLabelText(/new category name/i);
    await userEvent.type(box, "  Drinks  ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mutate).toHaveBeenCalledWith({ name: "Drinks" }, expect.anything());
    expect(box).toHaveValue("");
  });

  it("renames in place and shows a name clash on the row", async () => {
    categories.mockReturnValue({
      isPending: false,
      error: null,
      data: [
        { id: "c2", name: "Electronics", isDefault: false, productCount: 3 },
      ],
    });
    updateMutation.mockReturnValue({
      mutate,
      isPending: false,
      variables: { id: "c2", input: { name: "Household" } },
      error: new ApiError({
        message: "A category with this name already exists",
        status: 409,
        code: API_ERROR_CODE.CATEGORY_EXISTS,
      }),
    });

    render(wrap(<CategoryTab />));
    expect(
      screen.getByText(/a category with this name already exists/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /rename/i }));
    const field = screen.getByLabelText("Category name");
    await userEvent.clear(field);
    await userEvent.type(field, "Household");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "c2", input: { name: "Household" } },
      expect.anything(),
    );
  });

  it("renders the request id when the list itself fails to load", () => {
    categories.mockReturnValue({
      isPending: false,
      data: undefined,
      error: new ApiError({
        message: "The request failed.",
        status: 500,
        code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
        requestId: "req_42",
      }),
    });

    render(wrap(<CategoryTab />));
    expect(screen.getByText(/req_42/)).toBeInTheDocument();
  });
});
