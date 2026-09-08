# Slice 2 — Products, Categories, Stock and Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a business its catalogue and its customer book — add products, track stock, organise categories, keep customers — so the counter has something to sell and someone to sell it to.

**Architecture:** Four feature slices (`products`, `categories`, `customers`, `uploads`) built to the layering already established: page → components → hooks → services → `lib/api/client`. Nothing new architecturally; this slice is where the scaffolder and the conventions earn their keep.

**Tech Stack:** As Slice 1 — Next.js 16, React 19 + React Compiler, TanStack Query v5, axios, zod v4, react-hook-form, nuqs, Tailwind v4, shadcn base-nova on `@base-ui/react`, lucide, vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-09-07-frontend-ui-design-brief.md` §6.5 (products) and §6.6 (customers)
**Design canvas:** `docs/design/TradeOs-UI.dc.html` — artboards `2c` (line 489), `2d` (566), `2h` (984). Index in `docs/design/README.md`.
**API contract:** `docs/API-ROUTES.md` — every service function must correspond to a row in it.
**Repo rules:** `CLAUDE.md`. **Read `docs/FINDINGS.md` §1 and §2 before starting.**
**Scaffolder:** `.claude/skills/new-feature/` generates this exact slice shape. Use it.

---

## Global Constraints

Everything in Slice 1's Global Constraints still holds. In addition, specific to this slice:

- **Money and quantity are different things.** Money is 2 dp through `formatMoney(amount, currency)`; **quantities allow 3 dp** through `formatQuantity(value, unit)`. A product sold by weight has a quantity of `1.5`; its price does not.
- **`useOrganization()` supplies both `currency` and `timezone`.** Never hardcode either. `currency` can be `""` when a business has no currency config — render the number unlabelled rather than guessing.
- **Stock is not editable.** `PATCH /products/:id` does **not** move stock. The only ways quantity changes are `POST /products/:id/stock` (`restock` or a signed `adjustment`), a sale, and a void. A form field that appears to set quantity on an existing tracked product is a lie — see Task 6.
- **Untracked products have no quantity at all.** `trackStock: false` means services and fees. Their stock card, low-stock badge and movements table must all be absent, not zero.
- **Categories are never optional and never null.** Every product has one; omitting `categoryId` on create means the seeded **General**, which cannot be deleted (409 `CATEGORY_PROTECTED`). A foreign id is 422 `CATEGORY_NOT_FOUND` — never a silent fallback.
- **Archiving is not deleting.** `DELETE /customers/:id` and `DELETE /products/:id` archive. Use the word "Archive" everywhere, per brief §9.
- **Every list handles the six states** (brief §8.4) and puts its filters in the URL via `nuqs`, never in a store.
- **Definition of done for every task:** `bun run check` passes.

### Two places the canvas and the API disagree

Both verified against backend source. Do not "fix" them by inventing endpoints.

1. **Customer debt summary.** Artboard `2h` shows *Outstanding USD 76.50* and *Overdue USD 0.00* — two money figures. The API returns `{ open, overdue, totalRemaining }` where **`open` and `overdue` are counts** (`$sum: 1` in `Backend/src/db/actions/debt.actions.ts:197-210`) and only `totalRemaining` is an amount. So the panel can show *Outstanding* as money and *Overdue* only as **a count of debts**. Task 9 renders it honestly and says so in a comment.
2. **Category identity.** The brief describes the protected category by `key: "general"`. The wire field is **`isDefault: boolean`**, alongside `productCount` (`Backend/src/controller/category.controller.ts:8-16`). Gate the lock badge and the disabled delete on `isDefault`.

---

## File Structure

**Created — four feature slices**
- `features/products/` — `types.ts`, `keys.ts`, `schemas/product.schema.ts`, `services/product.service.ts`, `hooks/` (`use-products`, `use-product`, `use-product-mutations`, `use-stock-movements`, `use-stock-mutation`), `components/` (`product-table.tsx`, `product-filters.tsx`, `product-form.tsx`, `product-detail.tsx`, `stock-card.tsx`, `stock-movements-table.tsx`, `stock-dialog.tsx`, `stock-badge.tsx`)
- `features/categories/` — `types.ts`, `keys.ts`, `schemas/`, `services/`, `hooks/`, `components/category-tab.tsx`
- `features/customers/` — `types.ts`, `keys.ts`, `schemas/`, `services/`, `hooks/`, `components/` (`customer-table.tsx`, `customer-form-sheet.tsx`, `customer-detail.tsx`, `customer-debt-summary.tsx`)
- `features/uploads/` — `types.ts`, `keys.ts`, `services/`, `hooks/`, `components/image-picker.tsx`

**Created — pages**
- `app/(app)/products/page.tsx`, `products/new/page.tsx`, `products/[id]/page.tsx`
- `app/(app)/customers/page.tsx`, `customers/[id]/page.tsx`

**Modified**
- `config/routes.ts` — `ROUTES.productNew`, `customerNew` if needed; `ROUTE_PERMISSIONS` entries already exist for `/products` and `/customers`.

---

### Task 1: Products data layer

**Files:**
- Create: `features/products/types.ts`, `keys.ts`, `schemas/product.schema.ts` (+ `.test.ts`), `services/product.service.ts`, `hooks/use-products.ts`, `use-product.ts`, `use-product-mutations.ts`, `use-stock-movements.ts`, `use-stock-mutation.ts`
- Test: `features/products/schemas/product.schema.test.ts`

**Interfaces — later tasks depend on these exactly:**
- `Product = { id; name; barcode?; category: { id; name } | null; unit; costPrice; sellingPrice; trackStock; quantity; lowStockThreshold?; description?; images: { uploadId; url; thumbUrl }[]; status: "active" | "archived"; createdAt; updatedAt }`
- `StockMovement = { id; productId; type: "sale" | "sale_void" | "restock" | "adjustment"; quantity; quantityAfter; saleId?; reason?; createdBy; createdAt }`
- `useProducts(params): UseQueryResult<Paginated<Product>, ApiError>` — params `{ page?, limit?, search?, status?, categoryId?, lowStock? }`
- `useProduct(id)`, `useCreateProduct()`, `useUpdateProduct()`, `useArchiveProduct()`, `useProductByBarcode(code, { enabled })`
- `useStockMovements(productId, params)`, `useStockMutation(productId)`

- [ ] **Step 1: Read the backend contract, then write the failing schema test**

Read `../Backend/src/validators/product.validation.ts` in full. Mirror it exactly — `name` 1–120, `barcode` 4–64 matching `/^[A-Za-z0-9._-]+$/`, `unit` 1–20 default `"pcs"`, `costPrice`/`sellingPrice` through the money rules, `lowStockThreshold` a non-negative **integer**, `description` max 2000, `images` max 5 ObjectIds.

```ts
// features/products/schemas/product.schema.test.ts
import { describe, expect, it } from "vitest";
import { createProductSchema, stockMovementSchema } from "./product.schema";

const valid = {
  name: "Basmati rice 5 kg",
  unit: "kg",
  costPrice: 9.1,
  sellingPrice: 12.4,
  trackStock: true,
};

describe("createProductSchema", () => {
  it("accepts a product with no barcode and no category", () => {
    // Both are optional: an omitted category means the seeded General.
    expect(createProductSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a barcode with a space or under four characters", () => {
    for (const barcode of ["ab", "12 34"]) {
      expect(
        createProductSchema.safeParse({ ...valid, barcode }).success,
        barcode,
      ).toBe(false);
    }
  });

  it("rejects money with more than two decimals", () => {
    expect(
      createProductSchema.safeParse({ ...valid, sellingPrice: 12.456 }).success,
    ).toBe(false);
  });

  it("allows a three-decimal quantity, because goods are sold by weight", () => {
    expect(createProductSchema.safeParse({ ...valid, quantity: 1.505 }).success).toBe(true);
  });

  it("rejects a fractional low-stock threshold — it is a whole-unit alarm", () => {
    expect(
      createProductSchema.safeParse({ ...valid, lowStockThreshold: 2.5 }).success,
    ).toBe(false);
  });
});

describe("stockMovementSchema", () => {
  it("requires a reason for an adjustment but not for a restock", () => {
    expect(stockMovementSchema.safeParse({ type: "restock", quantity: 10 }).success).toBe(true);
    expect(stockMovementSchema.safeParse({ type: "adjustment", quantity: -3 }).success).toBe(false);
    expect(
      stockMovementSchema.safeParse({ type: "adjustment", quantity: -3, reason: "Damaged in transit" })
        .success,
    ).toBe(true);
  });

  it("refuses a zero adjustment, which would record a movement that moved nothing", () => {
    expect(
      stockMovementSchema.safeParse({ type: "adjustment", quantity: 0, reason: "x" }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `bunx vitest run features/products` — FAIL, module not found.

- [ ] **Step 3: Build types, keys, service and hooks**

Use `createQueryKeys("products")`. The service wraps the eight product rows in `docs/API-ROUTES.md` plus `GET /products/:id/stock-movements`. `useProducts` uses `placeholderData: keepPreviousData` so paging does not blank the table.

Mutations invalidate `productKeys.lists`; a stock mutation must **also** invalidate `productKeys.detail(id)` and the movements list, because a restock changes the product's `quantity` as well as adding a row.

- [ ] **Step 4: Run the tests, then commit**

```bash
bunx vitest run features/products && bun run check
git add features/products && git commit -m "feat(products): data layer"
```

---

### Task 2: Categories slice and the Categories tab

**Files:**
- Create: `features/categories/types.ts`, `keys.ts`, `schemas/category.schema.ts`, `services/category.service.ts`, `hooks/use-categories.ts`, `use-category-mutations.ts`, `components/category-tab.tsx` (+ `.test.tsx`)

**Interfaces:**
- `Category = { id; name; description?; isDefault: boolean; productCount: number; createdAt; updatedAt }`
- `useCategories()`, `useCreateCategory()`, `useUpdateCategory()`, `useDeleteCategory()`
- `<CategoryTab />` — the whole tab, self-contained.

- [ ] **Step 1: Write the failing test**

```tsx
// features/categories/components/category-tab.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CategoryTab } from "./category-tab";

const categories = vi.fn();
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: () => categories(),
}));
vi.mock("@/features/categories/hooks/use-category-mutations", () => ({
  useCreateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCategory: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/features/auth/hooks/use-permission", () => ({ useCan: () => true }));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

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
      data: [{ id: "c2", name: "Electronics", isDefault: false, productCount: 3 }],
    });

    render(wrap(<CategoryTab />));
    expect(screen.getByText(/3 products/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `bunx vitest run features/categories`

- [ ] **Step 3: Build the slice and the tab**

Artboard `2d` (the "Categories tab" block, around line 690) is the spec: a simple card list of name · product count, `Protected` badge on the default, inline rename, and a `New category name` + `Add` row at the bottom.

A delete refused with 409 `CATEGORY_IN_USE` shows **inline on that row** — "In use by 3 products" — not as a toast. `CATEGORY_PROTECTED` should never be reachable because the button is absent; if it arrives anyway, show it the same way.

- [ ] **Step 4: Tests and commit**

---

### Task 3: Customers data layer

**Files:**
- Create: `features/customers/types.ts`, `keys.ts`, `schemas/customer.schema.ts` (+ `.test.ts`), `services/customer.service.ts`, `hooks/use-customers.ts`, `use-customer.ts`, `use-customer-mutations.ts`

**Interfaces:**
- `Customer = { id; name; phone; email?; address?; notes?; status: "active" | "archived"; createdAt; updatedAt }`
- `CustomerDetail = { customer: Customer; debtSummary: { open: number; overdue: number; totalRemaining: number } }` — **`open` and `overdue` are counts.**
- `useCustomers(params)`, `useCustomer(id)`, `useCreateCustomer()`, `useUpdateCustomer()`, `useArchiveCustomer()`

- [ ] **Step 1: Write the failing schema test**

Mirror `../Backend/src/validators/customer.validation.ts`: `name` 1–120, **`phone` required**, 5–32, matching `/^\+?[\d\s\-().]+$/`, `email` optional and lowercased max 254, `address` max 300, `notes` max 2000.

```ts
// features/customers/schemas/customer.schema.test.ts
import { describe, expect, it } from "vitest";
import { createCustomerSchema } from "./customer.schema";

describe("createCustomerSchema", () => {
  it("requires a phone number — it is how a shop chases a debt", () => {
    expect(createCustomerSchema.safeParse({ name: "Bakaara Wholesale" }).success).toBe(false);
  });

  it("accepts the shapes people actually type", () => {
    for (const phone of ["+252 61 234 5678", "0712-345-678", "(020) 555 0134"]) {
      expect(
        createCustomerSchema.safeParse({ name: "Bakaara", phone }).success,
        phone,
      ).toBe(true);
    }
  });

  it("rejects letters in a phone number", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Bakaara", phone: "call me" }).success,
    ).toBe(false);
  });

  it("treats an omitted email as absent, not as an empty string", () => {
    const parsed = createCustomerSchema.safeParse({ name: "Bakaara", phone: "0712345678" });
    expect(parsed.success && "email" in parsed.data).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**
- [ ] **Step 3: Build the slice.** A `DUPLICATE_PHONE` 409 must map onto the `phone` field, not a banner.
- [ ] **Step 4: Tests and commit.**

---

### Task 4: Uploads slice and the ImagePicker

The one genuinely new capability in this slice. Brief §7 defines the component; `docs/API-ROUTES.md` gates all three upload routes on **`uploads:create`** — there is no `uploads:view`, so a Seller cannot open the gallery at all.

**Files:**
- Create: `features/uploads/types.ts`, `keys.ts`, `services/upload.service.ts`, `hooks/use-uploads.ts`, `use-upload-mutations.ts`, `components/image-picker.tsx` (+ `.test.tsx`)

**Interfaces:**
- `Upload = { id; url; thumbUrl; purpose: "product" | "announcement" | "project" | "logo"; attached: boolean; createdAt }`
- `<ImagePicker purpose value onChange max={5} />` where `value: string[]` is upload ids in display order.

- [ ] **Step 1: Write the failing test**

```tsx
// features/uploads/components/image-picker.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ImagePicker } from "./image-picker";

const uploads = vi.fn();
vi.mock("@/features/uploads/hooks/use-uploads", () => ({ useUploads: () => uploads() }));
vi.mock("@/features/uploads/hooks/use-upload-mutations", () => ({
  useCreateUpload: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteUpload: () => ({ mutate: vi.fn(), isPending: false }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("ImagePicker", () => {
  it("stops accepting uploads once max images are chosen", () => {
    uploads.mockReturnValue({ isPending: false, error: null, data: [] });
    render(
      wrap(
        <ImagePicker
          purpose="product"
          max={5}
          value={["u1", "u2", "u3", "u4", "u5"]}
          onChange={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/5 of 5/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add image/i)).not.toBeInTheDocument();
  });

  it("explains itself instead of breaking when storage is not configured", () => {
    // getStorage() returns null without S3 keys and every upload route answers
    // 503 STORAGE_NOT_CONFIGURED. A dev machine hits this constantly.
    uploads.mockReturnValue({
      isPending: false,
      data: undefined,
      error: { status: 503, code: "STORAGE_NOT_CONFIGURED", message: "Storage is not configured" },
    });
    render(wrap(<ImagePicker purpose="product" value={[]} onChange={vi.fn()} />));
    expect(screen.getByText(/image uploads are not set up/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the picker**

Two panes in a dialog: **Upload** (drag/drop, `image/jpeg,image/png,image/webp` only — HEIC is refused by the API) and **Your recent uploads** (`GET /uploads?attached=false`). Send `multipart/form-data` with fields `file` and `purpose`; **do not set `Content-Type` by hand** — the browser must add the multipart boundary.

Handle these codes inline: `UPLOAD_PENDING_LIMIT` (a member may hold at most five unattached uploads — tell them to use or delete one), `UNSUPPORTED_IMAGE`, `IMAGE_TOO_LARGE`, `STORAGE_NOT_CONFIGURED` (a calm empty state, not an error). Wrap the whole thing in `<PermissionGate permission={PERMISSIONS.UPLOADS_CREATE}>` at its call sites.

- [ ] **Step 4: Tests and commit.**

---

### Task 5: Products list page

**Files:**
- Create: `features/products/components/product-table.tsx`, `product-filters.tsx`, `stock-badge.tsx` (+ `stock-badge.test.tsx`), `features/products/components/products-page.tsx`
- Create: `app/(app)/products/page.tsx`
- Test: `features/products/components/stock-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// features/products/components/stock-badge.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockBadge } from "./stock-badge";

describe("StockBadge", () => {
  it("says Untracked for a service, rather than showing a quantity of zero", () => {
    // trackStock: false means a service or a fee. Zero would read as "sold out".
    render(<StockBadge trackStock={false} quantity={0} unit="pcs" />);
    expect(screen.getByText("Untracked")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("distinguishes out of stock from low stock", () => {
    const { rerender } = render(
      <StockBadge trackStock quantity={0} unit="pcs" lowStockThreshold={10} />,
    );
    expect(screen.getByText("Out")).toBeInTheDocument();

    rerender(<StockBadge trackStock quantity={4} unit="pcs" lowStockThreshold={10} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("is quiet when stock is healthy, and shows the quantity with its unit", () => {
    render(<StockBadge trackStock quantity={48} unit="kg" lowStockThreshold={10} />);
    expect(screen.getByText("48 kg")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("has no threshold to compare against, so it only reports the quantity", () => {
    render(<StockBadge trackStock quantity={2} unit="pcs" />);
    expect(screen.getByText("2 pcs")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the page**

Artboard `2c` (line 489). Title row with **New product** (`products:create`) and a secondary **Import** button that links to `/products/import` — **the import page does not exist in this slice**, so render it disabled with `title="Coming soon"` rather than a dead link.

Underline tabs: `All · Low stock · Categories`. Drop the canvas's fourth `Import` tab for the same reason, and say so in a comment. `Categories` renders `<CategoryTab />` from Task 2.

Filters through `nuqs`: `search` (debounced), `categoryId`, `status`. The **Low stock** tab is the same table with `lowStock=true` pinned. Columns per the canvas: Product (name + mono barcode beneath), Category, Unit, Cost, Price, Stock (`<StockBadge>`), Status. Money right-aligned via `align: "end"` and formatted with the org currency.

Row click → `/products/[id]`.

- [ ] **Step 4: Tests, visual check against `2c`, commit.**

---

### Task 6: Product form

**Files:**
- Create: `features/products/components/product-form.tsx` (+ `.test.tsx`), `app/(app)/products/new/page.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// features/products/components/product-form.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./product-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/categories/hooks/use-categories", () => ({
  useCategories: () => ({
    isPending: false,
    error: null,
    data: [{ id: "c1", name: "General", isDefault: true, productCount: 0 }],
  }),
}));
vi.mock("@/features/auth/hooks/use-permission", () => ({ useCan: () => true }));
const create = vi.fn();
vi.mock("@/features/products/hooks/use-product-mutations", () => ({
  useCreateProduct: () => ({ mutate: create, isPending: false, error: null }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("ProductForm", () => {
  it("hides the stock fields entirely when the product is untracked", async () => {
    render(wrap(<ProductForm mode="create" />));
    expect(screen.getByLabelText(/opening quantity/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /track stock/i }));

    expect(screen.queryByLabelText(/opening quantity/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/low stock/i)).not.toBeInTheDocument();
  });

  it("offers no quantity field when editing a tracked product", () => {
    // PATCH /products/:id does not move stock. A quantity box here would look
    // like it worked and change nothing — restock and adjust are the only ways.
    render(
      wrap(
        <ProductForm
          mode="edit"
          product={{
            id: "p1",
            name: "Basmati rice 5 kg",
            unit: "kg",
            costPrice: 9.1,
            sellingPrice: 12.4,
            trackStock: true,
            quantity: 48,
            category: { id: "c1", name: "General" },
            images: [],
            status: "active",
            createdAt: "",
            updatedAt: "",
          }}
        />,
      ),
    );
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the form**

Sections per brief §6.5.2: *Basics* (`name`, `barcode`, `categoryId` select defaulting to the `isDefault` category, `unit` with common options plus free entry, `description`); *Pricing* (`costPrice`, `sellingPrice`, and a computed **margin** shown muted — the canvas shows it on the detail page); *Stock* (`trackStock` switch revealing `quantity` **on create only** and `lowStockThreshold`); *Images* via `<ImagePicker purpose="product" max={5}>`, wrapped in a `PermissionGate` for `uploads:create`.

`DUPLICATE_BARCODE` maps onto the barcode field. `CATEGORY_NOT_FOUND` onto the category select.

- [ ] **Step 4: Tests and commit.**

---

### Task 7: Product detail, stock card, movements and the stock dialogs

The richest screen in this slice. Artboard `2d` (line 566) is the spec.

**Files:**
- Create: `features/products/components/product-detail.tsx`, `stock-card.tsx`, `stock-movements-table.tsx`, `stock-dialog.tsx` (+ `stock-dialog.test.tsx`)
- Create: `app/(app)/products/[id]/page.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// features/products/components/stock-dialog.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { StockDialog } from "./stock-dialog";

const mutate = vi.fn();
vi.mock("@/features/products/hooks/use-stock-mutation", () => ({
  useStockMutation: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const open = { open: true, onOpenChange: vi.fn(), productId: "p1", unit: "pcs", quantity: 48 };

describe("StockDialog", () => {
  it("previews the resulting quantity before anything is sent", async () => {
    // The canvas shows a "New quantity" line. Stock is the number a shop
    // trusts; showing the outcome first is how a typo gets caught.
    render(wrap(<StockDialog {...open} type="restock" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "12");
    expect(screen.getByText("60 pcs")).toBeInTheDocument();
  });

  it("requires a reason for an adjustment", async () => {
    render(wrap(<StockDialog {...open} type="adjustment" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "-3");
    await userEvent.click(screen.getByRole("button", { name: /adjust/i }));

    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("will not let an adjustment drive stock below zero", async () => {
    // The API refuses this with 409 INSUFFICIENT_STOCK; catching it here means
    // the user sees why while they are still looking at the number.
    render(wrap(<StockDialog {...open} type="adjustment" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "-100");
    expect(await screen.findByText(/only 48 pcs in stock/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the detail page**

Left: the image gallery (main + thumbs) when there are images, otherwise a quiet placeholder. Right: header (name, Edit, Archive), a **pricing card** — `Cost price`, `Selling price`, `Margin` — and the **stock card** from the canvas: a large mono quantity, the `Low`/`Out` badge, `Alert below N pcs`, and `Restock` / `Adjust` buttons (`products:adjust_stock`).

**An untracked product shows no stock card and no movements table** — a muted line saying stock is not tracked for this product.

Below: **Stock movements** table — Type (a pill: sale / sale_void / restock / adjustment), Change (signed, mono), Result (`quantityAfter`), Who, When, and Reason / receipt (a link to the sale when `saleId` is present). Paginated.

`Archive` opens a confirm dialog and calls `useArchiveProduct`. A 404 renders a not-found panel, not a crash.

- [ ] **Step 4: Tests, visual check against `2d`, commit.**

---

### Task 8: Customers list and the quick-create sheet

**Files:**
- Create: `features/customers/components/customer-table.tsx`, `customer-form-sheet.tsx` (+ `.test.tsx`), `customers-page.tsx`
- Create: `app/(app)/customers/page.tsx`

**Interface — Slice 3 depends on it:** `<CustomerFormSheet open onOpenChange onCreated?>` is the **same sheet the counter opens** for quick-create. Keep it self-contained and give it an `onCreated(customer)` callback so the counter can select the new customer immediately.

- [ ] **Step 1: Write the failing test**

```tsx
// features/customers/components/customer-form-sheet.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CustomerFormSheet } from "./customer-form-sheet";

const mutate = vi.fn();
vi.mock("@/features/customers/hooks/use-customer-mutations", () => ({
  useCreateCustomer: () => ({ mutate, isPending: false, error: null }),
  useUpdateCustomer: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("CustomerFormSheet", () => {
  it("will not submit without a phone number", async () => {
    render(wrap(<CustomerFormSheet open onOpenChange={vi.fn()} />));
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.click(screen.getByRole("button", { name: /save customer/i }));

    expect(await screen.findByText(/phone/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("hands the created customer back, so the counter can select it", async () => {
    const onCreated = vi.fn();
    mutate.mockImplementationOnce(
      (_input: unknown, opts?: { onSuccess?: (c: unknown) => void }) =>
        opts?.onSuccess?.({ id: "cu1", name: "Faisal Traders", phone: "0712345678" }),
    );

    render(wrap(<CustomerFormSheet open onOpenChange={vi.fn()} onCreated={onCreated} />));
    await userEvent.type(screen.getByLabelText("Name"), "Faisal Traders");
    await userEvent.type(screen.getByLabelText("Phone"), "0712345678");
    await userEvent.click(screen.getByRole("button", { name: /save customer/i }));

    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "cu1" }));
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the list and the sheet**

Artboard `2h` (line 984). Columns: Name, Phone (mono), Email, Address, Created, Status. **No balance column** — the list endpoint does not return one; balances live on the detail. Filters: `search`, `status`. CTA **New customer** (`customers:create`) opening the sheet.

Sheet fields per the canvas: Name, Phone, Email *(optional)*, Address *(optional)*, Notes *(optional)*, with `Cancel` / `Save customer`. `DUPLICATE_PHONE` maps to the phone field.

- [ ] **Step 4: Tests, visual check against `2h`, commit.**

---

### Task 9: Customer detail

**Files:**
- Create: `features/customers/components/customer-detail.tsx`, `customer-debt-summary.tsx` (+ `.test.tsx`)
- Create: `app/(app)/customers/[id]/page.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// features/customers/components/customer-debt-summary.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomerDebtSummary } from "./customer-debt-summary";

describe("CustomerDebtSummary", () => {
  it("shows outstanding as money and overdue as a count of debts", () => {
    // The canvas draws "Overdue USD 0.00", but the API returns a COUNT here,
    // not an amount (Backend/src/db/actions/debt.actions.ts:197). Printing a
    // count with a currency code would be a fabricated number.
    render(
      <CustomerDebtSummary
        summary={{ open: 3, overdue: 1, totalRemaining: 76.5 }}
        currency="USD"
      />,
    );

    expect(screen.getByText("USD 76.50")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.queryByText("USD 1.00")).not.toBeInTheDocument();
  });

  it("says a customer owes nothing rather than showing zeroes", () => {
    render(
      <CustomerDebtSummary summary={{ open: 0, overdue: 0, totalRemaining: 0 }} currency="USD" />,
    );
    expect(screen.getByText(/nothing outstanding/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Build the detail page**

Header: name, phone, email, address, status, `Edit` (opens the Task 8 sheet in edit mode) and `Archive` (`customers:delete`). Archiving is refused with 409 `CUSTOMER_HAS_OPEN_DEBT` while they owe anything — show that inline on the button, not as a toast.

The debt summary card as tested above. An archived customer shows the canvas's muted banner: *"Archived — cannot be sold to on credit."*

**Tabs: Debts and Sales.** Neither feature exists until Slice 3, so render both as an EmptyState reading *"Debts appear here once this customer buys on credit"* with a `// TODO(slice: 3)` comment naming the endpoint each will use (`GET /debts?customerId=` and `GET /sales?customerId=`). Do not invent the endpoints now.

- [ ] **Step 4: Tests, visual check against `2h`, commit.**

---

## Done when

- A business can add a product, give it a category, restock it, adjust it with a reason, and see every movement with who did it and why.
- A Seller sees the products list and the customers list but no **New product** button, no **Restock**, and no image picker.
- A business can add a customer, edit them, and see what they owe.
- Archiving a customer with an open debt is refused with an explanation, not a crash.
- `bun run check` passes and `bun run build` succeeds.
- `/products` and `/customers` match artboards `2c`, `2d` and `2h` at 1440px in both themes.

## Explicitly out of scope

The product import wizard (artboard `2e`, its own slice after the counter), the counter itself, debts, sales, and the Debts/Sales tabs on the customer detail — those are Slice 3. The Import button and tab render disabled.
