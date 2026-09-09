"use client";

import { cn } from "cn";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useCategories } from "@/features/categories/hooks/use-categories";
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/features/categories/hooks/use-category-mutations";
import {
  createCategorySchema,
  updateCategorySchema,
} from "@/features/categories/schemas/category.schema";
import type { Category } from "@/features/categories/types";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** "1 product" / "3 products" — the number a delete decision is made on. */
const countLabel = (count: number): string =>
  `${count} ${count === 1 ? "product" : "products"}`;

/**
 * What to say on the row when a write was refused.
 *
 * `CATEGORY_IN_USE` carries `details.productCount` from the server, which is
 * fresher than the count rendered beside the name — someone may have added a
 * product since the list was fetched — so it wins when it is there.
 *
 * `CATEGORY_PROTECTED` should be unreachable: the delete button is absent for
 * a default category rather than disabled. It is handled anyway because
 * `isDefault` is not actually the field the API protects on (see
 * `features/categories/types.ts`), so the guess can be wrong in either
 * direction and the user deserves the reason either way.
 */
const refusalNote = (error: ApiError, fallbackCount: number): string => {
  if (error.code === API_ERROR_CODE.CATEGORY_IN_USE) {
    const fromServer = error.details?.productCount;
    const count = typeof fromServer === "number" ? fromServer : fallbackCount;
    return `In use by ${countLabel(count)}. Move them to another category first.`;
  }
  return error.message;
};

/** The first message zod produced, ready to render under the field. */
const firstIssue = (issues: readonly { message: string }[]): string =>
  issues[0]?.message ?? "That name cannot be used.";

interface CategoryRowProps {
  category: Category;
  canUpdate: boolean;
  canDelete: boolean;
  note: string | null;
  requestId?: string;
  isRenaming: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function CategoryRow({
  category,
  canUpdate,
  canDelete,
  note,
  requestId,
  isRenaming,
  isSaving,
  isDeleting,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
}: CategoryRowProps) {
  const [draft, setDraft] = useState(category.name);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    // The same bounds the API enforces, checked here so a 61-character name is
    // refused while the user can still see what they typed.
    const parsed = updateCategorySchema.safeParse({ name: draft });
    if (!parsed.success) {
      setInvalid(firstIssue(parsed.error.issues));
      return;
    }
    setInvalid(null);
    onRename(draft.trim());
  };

  return (
    <li className="flex flex-col gap-[5px] border-border/60 border-b px-4 py-3 last:border-b-0">
      {isRenaming ? (
        <form onSubmit={submitRename} className="flex items-center gap-2.5">
          <Input
            aria-label="Category name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-9 flex-1 rounded-[9px] text-[13px]"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            aria-label={`Save ${category.name}`}
            disabled={isSaving}
          >
            <Check aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel rename"
            onClick={() => {
              setDraft(category.name);
              setInvalid(null);
              onCancelRename();
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="flex-1 truncate font-medium text-[13px] text-foreground">
            {category.name}
          </span>
          <span className="flex-none font-mono text-[11px] text-muted-foreground">
            {countLabel(category.productCount)}
          </span>
          {/* The canvas's lock. Gated on `key`, not `isDefault`: the latter
              is true for all four seeded categories and would mark every one
              of them protected. `key === "general"` is the single category
              DELETE actually refuses. */}
          {category.key === "general" ? (
            <Badge
              variant="secondary"
              className="h-[22px] flex-none rounded-lg bg-muted px-2 font-medium text-[11px] text-muted-foreground"
            >
              Protected
            </Badge>
          ) : null}
          {canUpdate ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Rename ${category.name}`}
              onClick={onStartRename}
            >
              <Pencil aria-hidden="true" />
            </Button>
          ) : null}
          {/* No delete for the protected category, and no disabled one either:
              a control the API will refuse is not shown at all (CLAUDE.md). */}
          {canDelete && category.key !== "general" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${category.name}`}
              onClick={onDelete}
              disabled={isDeleting}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      )}

      {invalid ? (
        <p className="text-[12px] text-destructive">{invalid}</p>
      ) : null}
      {note ? (
        <p className="text-[12px] text-warning-strong">
          {note}
          {requestId ? (
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
              Request ID: {requestId}
            </span>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The Categories tab of the Products page — design canvas artboard `2d`, the
 * "Categories tab" block around line 690: a card list of name and product
 * count with a `Protected` badge on the default, inline rename, and a
 * `New category name` + `Add` row at the bottom.
 *
 * Self-contained on purpose. The Products page renders `<CategoryTab />` and
 * passes nothing; every permission, every query and every refusal is handled
 * here, so the tab can move to Settings later without dragging props along.
 *
 * A refused delete lands on its own row rather than in a toast: the reason it
 * was refused is a product count, and the count is on the row. A toast would
 * separate the number from the thing it is about, and would be gone by the
 * time the user looked for it.
 */
export function CategoryTab() {
  const canCreate = useCan(PERMISSIONS.CATEGORIES_CREATE);
  const canUpdate = useCan(PERMISSIONS.CATEGORIES_UPDATE);
  const canDelete = useCan(PERMISSIONS.CATEGORIES_DELETE);

  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  const [newName, setNewName] = useState("");
  const [newNameIssue, setNewNameIssue] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    const parsed = createCategorySchema.safeParse({ name: newName });
    if (!parsed.success) {
      setNewNameIssue(firstIssue(parsed.error.issues));
      return;
    }
    setNewNameIssue(null);
    create.mutate(parsed.data, { onSuccess: () => setNewName("") });
  };

  const shell = (children: ReactNode) => (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card">
      {children}
    </div>
  );

  const addRow = canCreate ? (
    <form
      onSubmit={submitNew}
      className="flex flex-col gap-1.5 bg-muted/40 px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <Input
          aria-label="New category name"
          placeholder="New category name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          className="h-9 flex-1 rounded-[9px] text-[13px]"
        />
        <Button
          type="submit"
          size="lg"
          className="h-9 rounded-[9px] px-3.5 text-[13px]"
          disabled={create.isPending}
        >
          {create.isPending ? "Adding" : "Add"}
        </Button>
      </div>
      {newNameIssue ? (
        <p className="text-[12px] text-destructive">{newNameIssue}</p>
      ) : null}
      {/* A name already taken is 409 CATEGORY_EXISTS — shown at the box the
          user has to change, not over the list. */}
      {create.error ? (
        <p className="text-[12px] text-warning-strong">
          {create.error.message}
        </p>
      ) : null}
    </form>
  ) : null;

  if (categories.isPending) {
    return shell(
      <ul className="flex flex-col">
        {["a", "b", "c", "d", "e"].map((row) => (
          <li
            key={row}
            className="flex items-center gap-2.5 border-border/60 border-b px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-3.5 max-w-[9rem] flex-1" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>,
    );
  }

  if (categories.error) {
    // A 403 is a role without `categories:view`. That is a calm absence, not a
    // failure worth a retry button — the page around this tab still works.
    if (categories.error.status === 403) {
      return shell(
        <EmptyState
          title="No access to categories"
          description="Your role cannot view the category list. An owner or manager can change that."
        />,
      );
    }
    return (
      <ErrorCard
        error={categories.error}
        retry={() => void categories.refetch()}
        title="Couldn't load categories"
      />
    );
  }

  const rows = categories.data ?? [];

  if (rows.length === 0) {
    return shell(
      <>
        <EmptyState
          title="No categories yet"
          description="Categories group products on the counter and in reports."
        />
        {addRow}
      </>,
    );
  }

  return shell(
    <>
      <ul className={cn("flex flex-col")}>
        {rows.map((category) => {
          // One mutation instance serves the whole list, so `variables` is what
          // says which row a failure belongs to.
          const deleteFailed =
            remove.error && remove.variables === category.id
              ? remove.error
              : null;
          const renameFailed =
            update.error && update.variables?.id === category.id
              ? update.error
              : null;
          const failure = deleteFailed ?? renameFailed;

          return (
            <CategoryRow
              key={category.id}
              category={category}
              canUpdate={canUpdate}
              canDelete={canDelete}
              note={
                failure ? refusalNote(failure, category.productCount) : null
              }
              requestId={failure?.requestId}
              isRenaming={renamingId === category.id}
              isSaving={update.isPending}
              isDeleting={remove.isPending && remove.variables === category.id}
              onStartRename={() => setRenamingId(category.id)}
              onCancelRename={() => setRenamingId(null)}
              onRename={(name) =>
                update.mutate(
                  { id: category.id, input: { name } },
                  { onSuccess: () => setRenamingId(null) },
                )
              }
              onDelete={() => remove.mutate(category.id)}
            />
          );
        })}
      </ul>
      {addRow}
    </>,
  );
}
