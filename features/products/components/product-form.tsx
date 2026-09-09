"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { type DefaultValues, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useCategories } from "@/features/categories/hooks/use-categories";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  useCreateProduct,
  useUpdateProduct,
} from "@/features/products/hooks/use-product-mutations";
import {
  type CreateProductInput,
  createProductSchema,
  type UpdateProductInput,
} from "@/features/products/schemas/product.schema";
import type { Product } from "@/features/products/types";
import { ImagePicker } from "@/features/uploads/components/image-picker";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatMoney, formatQuantity } from "@/lib/format/money";

/**
 * The form's own values, which are NOT the create payload.
 *
 * `createProductSchema` is the mirror of the backend validator and stays the
 * authority on every bound; this only re-declares `trackStock` without its
 * `.default(true)`. The default would make the *input* type
 * `boolean | undefined`, and the switch below has two states, not three — it
 * would have to render an absent value as something, and every choice there is
 * a lie about what the form will send.
 *
 * Input and output still differ (`unit` and `quantity` keep their defaults),
 * which is why `useForm` is given three generics: react-hook-form holds
 * `z.input`, and `handleSubmit` hands back `z.output`.
 *
 * `categoryId` and `images` drop the 24-hex ObjectId check for the same
 * reason: neither is ever typed. A category id can only come from an option
 * this form rendered out of `GET /categories`, and an image id can only come
 * from an upload the API itself just minted. So the regex can never catch a
 * user's mistake — the only value it can ever reject is one the server handed
 * us a moment ago, which would strand the form on data it did not create. The
 * API is the authority on whether an id is real (422 `CATEGORY_NOT_FOUND`),
 * and it is the only party that can be. `max(5)` stays, because that is a rule
 * about this form rather than about an id's spelling.
 */
const productFormSchema = createProductSchema.extend({
  trackStock: z.boolean(),
  categoryId: z.string().optional(),
  images: z.array(z.string()).max(5, "At most 5 images").optional(),
});

type ProductFormValues = z.input<typeof productFormSchema>;
type ProductFormOutput = z.output<typeof productFormSchema>;
type ProductField = keyof ProductFormValues;

/** The keys a 422's `errors` map may be written onto. Anything else is a banner. */
const FORM_FIELDS: readonly string[] = [
  "name",
  "barcode",
  "categoryId",
  "unit",
  "costPrice",
  "sellingPrice",
  "trackStock",
  "quantity",
  "lowStockThreshold",
  "description",
  "images",
];

/**
 * Suggestions, not a closed list — offered through a `datalist` so the field
 * stays free text. `unit` on the wire is any string of 1 to 20 characters, and
 * a shop that sells by the `debe` or the `kiish` must be able to type it.
 */
const UNIT_SUGGESTIONS = [
  "pcs",
  "kg",
  "g",
  "l",
  "ml",
  "m",
  "box",
  "carton",
  "packet",
  "dozen",
  "pair",
  "hour",
] as const;

const CONTROL =
  "h-[38px] w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

/**
 * Gross margin, the way artboard `2d` reads it: what share of the price the
 * business keeps.
 *
 * `(selling - cost) / selling`, **not** `(selling - cost) / cost`. The second
 * is markup; it is a bigger number for the same two prices (36.3% against
 * 26.6% for 9.10 and 12.40), and a form that showed it under the word "margin"
 * would flatter every product on the screen.
 *
 * `null` when there is no selling price to divide by — a half-filled form must
 * not print `Infinity%`.
 */
const marginPercent = (cost: number, selling: number): number | null => {
  if (!Number.isFinite(cost) || !Number.isFinite(selling) || selling <= 0) {
    return null;
  }
  return ((selling - cost) / selling) * 100;
};

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((id, index) => id === right[index]);

/** Form values into `POST /products`, dropping every optional left alone. */
function toCreateInput(values: ProductFormOutput): CreateProductInput {
  const description = values.description?.trim() ?? "";
  const images = values.images ?? [];

  return {
    name: values.name,
    unit: values.unit,
    costPrice: values.costPrice,
    sellingPrice: values.sellingPrice,
    trackStock: values.trackStock,
    // Zero for an untracked product, which is what `createProductSchema`'s own
    // default produces and what the backend stores for a service or a fee.
    quantity: values.trackStock ? values.quantity : 0,
    ...(values.barcode ? { barcode: values.barcode } : {}),
    ...(values.categoryId ? { categoryId: values.categoryId } : {}),
    ...(values.trackStock && values.lowStockThreshold !== undefined
      ? { lowStockThreshold: values.lowStockThreshold }
      : {}),
    ...(description === "" ? {} : { description }),
    ...(images.length === 0 ? {} : { images }),
  };
}

/**
 * Form values into `PATCH /products/:id`, carrying **only what changed**.
 *
 * The backend's `updateProductSchema` no longer re-applies `unit`'s and
 * `trackStock`'s defaults to keys the caller omitted (`Backend` commit
 * `cb46775`), so a partial body is genuinely partial and there is nothing to
 * resend defensively — see the long comment on `updateProductSchema` in
 * `../schemas/product.schema.ts`.
 *
 * `quantity` is included in exactly one case: `trackStock` moving
 * `false` to `true`. Everywhere else the API destructures it out of the body
 * and throws it away (`../Backend/src/services/product.service.ts:277`), so
 * sending it would be a 200 that moved nothing.
 */
function toUpdateInput(
  values: ProductFormOutput,
  product: Product,
): UpdateProductInput {
  const input: UpdateProductInput = {};

  if (values.name !== product.name) input.name = values.name;
  if (values.barcode !== undefined && values.barcode !== product.barcode) {
    input.barcode = values.barcode;
  }
  if (
    values.categoryId !== undefined &&
    values.categoryId !== product.category?.id
  ) {
    input.categoryId = values.categoryId;
  }
  if (values.unit !== product.unit) input.unit = values.unit;
  if (values.costPrice !== product.costPrice) {
    input.costPrice = values.costPrice;
  }
  if (values.sellingPrice !== product.sellingPrice) {
    input.sellingPrice = values.sellingPrice;
  }
  if (values.trackStock !== product.trackStock) {
    input.trackStock = values.trackStock;
  }
  if (
    values.lowStockThreshold !== undefined &&
    values.lowStockThreshold !== product.lowStockThreshold
  ) {
    input.lowStockThreshold = values.lowStockThreshold;
  }

  // An empty string is a valid `description` on both sides of the wire, so
  // this is the one optional the form can actually clear.
  const description = values.description ?? "";
  if (description !== (product.description ?? "")) {
    input.description = description;
  }

  const images = values.images ?? [];
  const attached = product.images.map((image) => image.uploadId);
  if (!sameIds(images, attached)) input.images = images;

  // The only PATCH that is allowed to carry an opening count.
  if (values.trackStock && !product.trackStock) {
    input.quantity = values.quantity;
  }

  return input;
}

function defaultsFor(product?: Product): DefaultValues<ProductFormValues> {
  return {
    name: product?.name ?? "",
    barcode: product?.barcode,
    categoryId: product?.category?.id,
    unit: product?.unit ?? "pcs",
    // Left genuinely absent rather than 0: a pristine create form must not
    // open with a price already in it, and 0 is a price the schema accepts.
    costPrice: product?.costPrice,
    sellingPrice: product?.sellingPrice,
    trackStock: product?.trackStock ?? true,
    // Always 0, never `product.quantity` — this field is an OPENING count, and
    // on an edit it is only ever read when tracking is being switched on,
    // where the product's frozen quantity is not the answer.
    quantity: 0,
    lowStockThreshold: product?.lowStockThreshold,
    description: product?.description ?? "",
    images: product?.images.map((image) => image.uploadId) ?? [],
  };
}

export type ProductFormProps = {
  /** Where to go after a successful save. Defaults to the products list. */
  onSaved?: (product: Product) => void;
  onCancel?: () => void;
} & (
  | { mode: "create"; product?: undefined }
  | { mode: "edit"; product: Product }
);

/**
 * Add a product, or change one (brief §6.5.2, the plan's Task 6).
 *
 * **The rule this component exists to encode: `PATCH /products/:id` does not
 * move stock.** So the Stock section has three shapes, not one:
 *
 * 1. **Create, tracking on** — an `Opening quantity`, which the API writes as
 *    an `adjustment` movement reasoned "Initial stock".
 * 2. **Edit, already tracked** — no quantity control at all, and a line saying
 *    where stock does move. A box that posts a number the server discards
 *    looks like it worked and changes nothing, which is worse than its
 *    absence.
 * 3. **Edit, tracking being switched on** — `Opening quantity` returns,
 *    because this is the one case the API honours a body `quantity` in.
 *    Omitting it there is not "leave stock alone", it is `quantity = 0`.
 *
 * With the switch off there are no stock fields whatsoever: `trackStock: false`
 * means a service or a fee, and those have no quantity to speak of.
 */
export function ProductForm({
  mode,
  product,
  onSaved,
  onCancel,
}: ProductFormProps) {
  const uid = useId();
  const router = useRouter();
  const categories = useCategories();
  const { currency } = useOrganization();
  const canUpload = useCan(PERMISSIONS.UPLOADS_CREATE);
  const create = useCreateProduct();
  const update = useUpdateProduct();

  /** A failure that did not land on a field. Cleared on every new submit. */
  const [banner, setBanner] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues, unknown, ProductFormOutput>({
    resolver: zodResolver(productFormSchema),
    mode: "onTouched",
    defaultValues: defaultsFor(product),
  });

  const trackStock = watch("trackStock") ?? true;
  const unit = watch("unit") ?? "";
  const costPrice = watch("costPrice");
  const sellingPrice = watch("sellingPrice");
  const images = watch("images") ?? [];

  const isBusy = isSubmitting || create.isPending || update.isPending;

  /**
   * Opening stock is asked for on a create, and on the one edit that turns
   * tracking on. Never on an edit of a product that is already tracked.
   */
  const asksOpeningQuantity =
    trackStock && (mode === "create" || product.trackStock === false);

  const margin = marginPercent(costPrice, sellingPrice);
  const marginAmount =
    Number.isFinite(costPrice) && Number.isFinite(sellingPrice)
      ? sellingPrice - costPrice
      : null;

  /**
   * A refusal goes to the field that caused it, and to a banner only when it
   * belongs to no field (brief §8.4). Branches on `code`, never on `message`.
   */
  const onFailure = (error: ApiError) => {
    let handled = false;

    for (const [field, message] of Object.entries(fieldErrorsFor(error))) {
      if (FORM_FIELDS.includes(field)) {
        setError(field as ProductField, { type: "server", message });
        handled = true;
      }
    }

    if (error.code === API_ERROR_CODE.DUPLICATE_BARCODE) {
      setError("barcode", {
        type: "server",
        message: "That barcode already belongs to another product.",
      });
      handled = true;
    }

    if (error.code === API_ERROR_CODE.CATEGORY_NOT_FOUND) {
      setError("categoryId", {
        type: "server",
        message: "That category no longer exists here. Pick another one.",
      });
      handled = true;
    }

    setBanner(handled ? null : error.message);
  };

  const onSuccess = (saved: Product) => {
    if (onSaved) {
      onSaved(saved);
      return;
    }
    // The detail page (task 7) now exists, so a save lands on the thing that
    // was just saved rather than back in the list. `useCreateProduct` has
    // already seeded `productKeys.detail(id)` from the create response, so
    // this arrives with data and never flashes a skeleton.
    router.push(ROUTES.product(saved.id));
  };

  const onSubmit = handleSubmit((values) => {
    setBanner(null);
    setNote(null);

    if (mode === "create") {
      create.mutate(toCreateInput(values), { onSuccess, onError: onFailure });
      return;
    }

    // `barcode` is `.min(4)` and not nullable on either side of the wire, so
    // there is no value a PATCH can send to remove one. Saying so beats
    // dropping the change silently, or posting a body that is a 422.
    if (product.barcode !== undefined && values.barcode === undefined) {
      setError("barcode", {
        type: "manual",
        message:
          "A barcode can't be removed once it is set — change it to a different code instead.",
      });
      return;
    }

    const input = toUpdateInput(values, product);
    if (Object.keys(input).length === 0) {
      // `updateProductSchema` refuses an empty body with "Nothing to update".
      // Answering here costs no round trip and reads as an answer, not an
      // error.
      setNote("Nothing has changed yet.");
      return;
    }

    update.mutate({ id: product.id, input }, { onSuccess, onError: onFailure });
  });

  const errorLine = (field: ProductField) => {
    const message = errors[field]?.message;
    return message ? (
      <p id={`${uid}-${field}-error`} className="text-[12px] text-destructive">
        {message}
      </p>
    ) : null;
  };

  const described = (field: ProductField, hint?: string) => {
    const parts = [
      errors[field] ? `${uid}-${field}-error` : null,
      hint ?? null,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? undefined : parts.join(" ");
  };

  return (
    // `noValidate`: the browser's own bubble on a `type="number"` step
    // mismatch would preempt the resolver, and the user would never see the
    // form's own message.
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex max-w-[760px] flex-col gap-5"
    >
      {banner ? (
        <p className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-3 text-[13px] text-destructive-strong">
          {banner}
        </p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-[13px] text-foreground">Basics</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-name`} className="text-[13px]">
            Name
          </Label>
          <Input
            {...register("name")}
            id={`${uid}-name`}
            autoComplete="off"
            disabled={isBusy}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={described("name")}
            className={CONTROL}
          />
          {errorLine("name")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-barcode`} className="text-[13px]">
              Barcode
            </Label>
            <Input
              {...register("barcode", {
                setValueAs: (value: unknown) => {
                  const text = typeof value === "string" ? value.trim() : "";
                  return text === "" ? undefined : text;
                },
              })}
              id={`${uid}-barcode`}
              autoComplete="off"
              inputMode="numeric"
              disabled={isBusy}
              aria-invalid={errors.barcode ? true : undefined}
              aria-describedby={described("barcode", `${uid}-barcode-hint`)}
              className={cn(CONTROL, "font-mono")}
            />
            <p
              id={`${uid}-barcode-hint`}
              className="text-[12px] text-muted-foreground"
            >
              Optional. What a scanner reads at the counter.
            </p>
            {errorLine("barcode")}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-categoryId`} className="text-[13px]">
              Category
            </Label>
            <select
              {...register("categoryId", {
                setValueAs: (value: unknown) =>
                  typeof value === "string" && value !== "" ? value : undefined,
              })}
              id={`${uid}-categoryId`}
              disabled={isBusy || categories.isPending}
              aria-invalid={errors.categoryId ? true : undefined}
              aria-describedby={described("categoryId")}
              className={CONTROL}
            >
              {/*
                An empty option, and NOT one preselected to
                `categories.find((c) => c.isDefault)`.

                `isDefault` is true for all four categories seeded with an
                organization — read the comment on it in
                `features/categories/types.ts` — so that find returns whichever
                of General, Food & Drinks, Household and Electronics sorts
                first, which is Electronics. The protected General category is
                identified by `key: "general"`, and `key` is not on the wire.
                Omitting `categoryId` entirely is the only reliable way to land
                a product in General, so that is what this option does.

                Dropped on an edit, where the product already has a category
                and a PATCH has no way to say "move it back to the default".
              */}
              {mode === "create" || product.category === null ? (
                <option value="">
                  {mode === "create" ? "Default category" : "Choose a category"}
                </option>
              ) : null}
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {errorLine("categoryId")}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-unit`} className="text-[13px]">
              Unit
            </Label>
            <Input
              {...register("unit")}
              id={`${uid}-unit`}
              list={`${uid}-units`}
              autoComplete="off"
              disabled={isBusy}
              aria-invalid={errors.unit ? true : undefined}
              aria-describedby={described("unit", `${uid}-unit-hint`)}
              className={CONTROL}
            />
            <datalist id={`${uid}-units`}>
              {UNIT_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            <p
              id={`${uid}-unit-hint`}
              className="text-[12px] text-muted-foreground"
            >
              How this is counted. Pick one or type your own.
            </p>
            {errorLine("unit")}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-description`} className="text-[13px]">
            Description
          </Label>
          <textarea
            {...register("description")}
            id={`${uid}-description`}
            rows={3}
            disabled={isBusy}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={described("description")}
            className={cn(CONTROL, "h-auto py-2 leading-relaxed")}
          />
          {errorLine("description")}
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-[13px] text-foreground">Pricing</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-costPrice`} className="text-[13px]">
              Cost price
            </Label>
            <Input
              {...register("costPrice", { valueAsNumber: true })}
              id={`${uid}-costPrice`}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              disabled={isBusy}
              aria-invalid={errors.costPrice ? true : undefined}
              aria-describedby={described("costPrice")}
              className={cn(CONTROL, "font-mono")}
            />
            {errorLine("costPrice")}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-sellingPrice`} className="text-[13px]">
              Selling price
            </Label>
            <Input
              {...register("sellingPrice", { valueAsNumber: true })}
              id={`${uid}-sellingPrice`}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              disabled={isBusy}
              aria-invalid={errors.sellingPrice ? true : undefined}
              aria-describedby={described("sellingPrice")}
              className={cn(CONTROL, "font-mono")}
            />
            {errorLine("sellingPrice")}
          </div>
        </div>

        {/*
          Gross margin, muted, as artboard `2d` draws it on the detail page.
          Shown as a share of the selling price AND as the money kept per unit:
          the percentage is what a buyer compares across products, the amount is
          what the shop actually takes, and printing both removes any question
          about which denominator produced the percentage.
        */}
        <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
          <span>Margin</span>
          {margin === null ? (
            <span>—</span>
          ) : (
            <>
              <span
                className={cn(
                  "font-mono",
                  margin < 0 && "text-destructive-strong",
                )}
              >
                {margin.toFixed(1)}%
              </span>
              {marginAmount === null ? null : (
                <span className="font-mono">
                  {formatMoney(marginAmount, currency)}
                  {unit ? ` per ${unit}` : ""}
                </span>
              )}
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-[13px] text-foreground">Stock</h2>

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span
              id={`${uid}-trackStock-label`}
              className="font-medium text-[13px] text-foreground"
            >
              Track stock
            </span>
            <span className="text-[12px] text-muted-foreground">
              Turn this off for a service or a fee. Those have no quantity at
              all — not a quantity of zero.
            </span>
          </div>

          {/*
            A button carrying `role="switch"`, not a checkbox: this is a
            two-state control that commits immediately, and `components/ui/`
            has no switch primitive vendored (regenerate it, never hand-edit
            it — CLAUDE.md). The label is a sibling rather than the button's
            own text so the switch can sit at the end of the row, which is how
            the canvas draws it.
          */}
          <button
            type="button"
            role="switch"
            aria-checked={trackStock}
            aria-labelledby={`${uid}-trackStock-label`}
            disabled={isBusy}
            onClick={() =>
              setValue("trackStock", !trackStock, { shouldDirty: true })
            }
            className={cn(
              "relative h-[22px] w-[38px] flex-none rounded-full border border-transparent transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
              trackStock ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-[2px] size-[16px] rounded-full bg-background transition-all",
                trackStock ? "left-[18px]" : "left-[2px]",
              )}
            />
          </button>
        </div>

        {trackStock ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {asksOpeningQuantity ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-quantity`} className="text-[13px]">
                  Opening quantity
                </Label>
                <Input
                  {...register("quantity", {
                    setValueAs: (value: unknown) =>
                      value === "" || value === undefined ? 0 : Number(value),
                  })}
                  id={`${uid}-quantity`}
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  disabled={isBusy}
                  aria-invalid={errors.quantity ? true : undefined}
                  aria-describedby={described(
                    "quantity",
                    `${uid}-quantity-hint`,
                  )}
                  className={cn(CONTROL, "font-mono")}
                />
                <p
                  id={`${uid}-quantity-hint`}
                  className="text-[12px] text-muted-foreground"
                >
                  What is on the shelf right now. It is recorded as the first
                  stock movement; every change after it goes through Restock or
                  Adjust.
                </p>
                {errorLine("quantity")}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor={`${uid}-lowStockThreshold`}
                className="text-[13px]"
              >
                Low stock alert
              </Label>
              <Input
                {...register("lowStockThreshold", {
                  setValueAs: (value: unknown) =>
                    value === "" || value === undefined
                      ? undefined
                      : Number(value),
                })}
                id={`${uid}-lowStockThreshold`}
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                disabled={isBusy}
                aria-invalid={errors.lowStockThreshold ? true : undefined}
                aria-describedby={described(
                  "lowStockThreshold",
                  `${uid}-lowStockThreshold-hint`,
                )}
                className={cn(CONTROL, "font-mono")}
              />
              <p
                id={`${uid}-lowStockThreshold-hint`}
                className="text-[12px] text-muted-foreground"
              >
                Optional whole number. Leave it empty and this product never
                reads as low, however few are left.
              </p>
              {errorLine("lowStockThreshold")}
            </div>
          </div>
        ) : null}

        {/*
          The rule this form exists to encode. `PATCH /products/:id` reads
          `quantity` off the body and throws it away unless `trackStock` is
          flipping false to true
          (`../Backend/src/services/product.service.ts:277`), so an
          already-tracked product gets a sentence here instead of a box that
          would answer 200 and move nothing.
        */}
        {mode === "edit" && product.trackStock && trackStock ? (
          <p className="text-[12px] text-muted-foreground">
            {formatQuantity(product.quantity, product.unit)} in stock. Stock
            moves through Restock and Adjust on the product itself — a sale and
            a void move it too — never from this form.
          </p>
        ) : null}
      </section>

      {/*
        All three upload routes are gated on `uploads:create` and there is no
        `uploads:view`, so a Seller cannot open the gallery at all. Gated with
        `useCan` rather than `<PermissionGate>` because that component reads the
        session itself and renders nothing while it loads, which would make the
        picker flash in after the rest of the form has settled.
      */}
      {canUpload ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
          <ImagePicker
            purpose="product"
            max={5}
            value={images}
            onChange={(ids) =>
              setValue("images", ids, { shouldDirty: true, shouldTouch: true })
            }
            // Mandatory on an edit: the gallery lists UNATTACHED uploads, and
            // an image already on this product is attached, so without this
            // every saved id would render as a numbered placeholder tile.
            known={product?.images}
            disabled={isBusy}
          />
          {errorLine("images")}
        </section>
      ) : null}

      {note ? (
        <p className="text-[13px] text-muted-foreground">{note}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2.5">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={onCancel}
            className="h-10 rounded-[10px] px-4 text-[13px]"
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-10 rounded-[10px] px-4 text-[13px]"
            render={<Link href={ROUTES.products} />}
          >
            Cancel
          </Button>
        )}

        <Button
          type="submit"
          disabled={isBusy}
          className="h-10 rounded-[10px] px-4 text-[13px]"
        >
          {isBusy
            ? "Saving…"
            : mode === "create"
              ? "Save product"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
