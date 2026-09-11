"use client";

import { cn } from "cn";
import { Camera, PackageSearch, ScanBarcode, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/features/categories/hooks/use-categories";
import { useProducts } from "@/features/products/hooks/use-products";
import type { Product } from "@/features/products/types";
import {
  isOutOfStock,
  ProductTile,
} from "@/features/sales/components/counter/product-tile";
import { ScanSheet } from "@/features/sales/components/counter/scan-sheet";
import { useCameraSupport } from "@/features/sales/hooks/use-camera-scanner";

/** `customer-picker.tsx`'s figure, and for the same reason: one request per
 *  pause, not one per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Three rows of the canvas's 3-column grid.
 *
 * There is no pager here on purpose. A counter is a place to find one thing
 * fast, not to browse a catalogue — the search box and the category chips are
 * the navigation, and a "page 4 of 31" control invites reading the shelf off a
 * screen. When the filter matches more than this, the grid says so in words.
 */
const GRID_LIMIT = 12;

/** Matches the canvas's chip row: `All` plus whatever the shop has named. */
const ALL_CATEGORIES = "";

export interface CatalogPaneProps {
  /** The business's MAIN currency code, for every price on a tile. */
  currency: string;
  onAdd: (product: Product) => void;
  /** True while a sale is in flight — the catalogue stops accepting taps. */
  disabled?: boolean;
  className?: string;
}

/**
 * The left half of artboard `2a`: the scan/search field, the category chips
 * and the product grid.
 *
 * **One field serves both the scanner and the search.** `GET /products`'s
 * `search` is a prefix match on the name **OR an exact barcode match** — one
 * parameter, two behaviours, and the backend says so in its own comment ("the
 * scan lookup and the free-text search share one query parameter",
 * `../Backend/src/db/actions/product.actions.ts:59-63`). So there is no second
 * query here and no second cache: `GET /products/barcode/:code` exists, and
 * `useProductByBarcode` wraps it, but reaching for it would mean deciding on
 * every keystroke whether a half-typed value is a barcode or a name — and that
 * endpoint answers 422 for anything under 4 characters.
 *
 * `status: "active"` is explicit rather than left to the server's default. An
 * archived product is a 409 `PRODUCT_ARCHIVED` at commit time, so it must never
 * be a tile to tap.
 */
export function CatalogPane({
  currency,
  onAdd,
  disabled,
  className,
}: CatalogPaneProps) {
  const uid = useId();
  const searchId = `${uid}-search`;

  // What is in the box, and what the results on screen belong to. They differ
  // for `SEARCH_DEBOUNCE_MS` after each keystroke.
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES);
  /** The term a scan (or an Enter) submitted, still waiting for its answer. */
  const [scanning, setScanning] = useState<string | null>(null);
  /** A submitted term that matched nothing — the only thing a scanner gets wrong. */
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraSupport = useCameraSupport();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const categories = useCategories();
  const products = useProducts({
    limit: GRID_LIMIT,
    status: "active",
    // Both keys are dropped rather than sent empty: `listProductsQuerySchema`
    // is `.strict()` with `search` at `min(1)` and `categoryId` an ObjectId, so
    // `?search=` is a 422 — and an empty box is this pane's normal state.
    // Dropping them also keeps `{}` and `{ search: "" }` from hashing to two
    // React Query keys for one identical request.
    ...(search === "" ? {} : { search }),
    ...(categoryId === ALL_CATEGORIES ? {} : { categoryId }),
  });

  const rows = products.data?.items ?? [];
  const total = products.data?.meta.total ?? 0;
  const settled = !products.isPending && !products.isPlaceholderData;

  /*
   * The scanner path, and the one effect on this screen.
   *
   * A scan arrives as a burst of keystrokes ending in Enter, which is why Enter
   * commits the term immediately instead of waiting out the debounce — but the
   * answer still arrives a request later, and adding a line is a side effect
   * that cannot happen during render. So: Enter records which term is in
   * flight, and this runs once when the results for *that* term land.
   *
   * `isPlaceholderData` is what makes it correct. `useProducts` keeps the
   * previous page on screen while the next loads, so without that guard a scan
   * would be matched against whatever the grid was showing beforehand and
   * would ring up the wrong product.
   *
   * It fires on every render and returns on the first line for almost all of
   * them; clearing `scanning` first is what stops it running twice for one scan.
   */
  useEffect(() => {
    if (scanning === null || scanning !== search || !settled) return;
    setScanning(null);

    const matches = products.data?.items ?? [];
    const only = matches.length === 1 ? matches[0] : undefined;

    // Exactly one match, and it is sellable: ring it up and clear the box for
    // the next scan. Two or more is a name prefix, not a barcode — those stay
    // on screen to be tapped, because guessing which one was meant is how the
    // wrong thing ends up on a receipt.
    if (only && !isOutOfStock(only)) {
      onAdd(only);
      setDraft("");
      setSearch("");
      setScanMiss(null);
      return;
    }

    setScanMiss(matches.length === 0 ? scanning : null);
  }, [scanning, search, settled, products.data, onAdd]);

  const commit = (next: string) => {
    setDraft(next);
    setScanMiss(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setSearch(next.trim()),
      SEARCH_DEBOUNCE_MS,
    );
  };

  const submit = () => {
    const term = draft.trim();
    if (term === "") return;
    // Straight past the debounce: a scanner has already finished typing, and
    // 300ms of nothing after a beep reads as a dropped scan.
    if (timer.current) clearTimeout(timer.current);
    setSearch(term);
    setScanning(term);
  };

  const filtered = search !== "" || categoryId !== ALL_CATEGORIES;

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <form
        // Its own form, a sibling of the payment panel's rather than nested in
        // it: Enter in this box must find a product, never complete a sale.
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex gap-3"
      >
        <div className="group flex h-[52px] flex-1 items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <ScanBarcode
            className="size-[18px] flex-none text-muted-foreground transition-colors group-focus-within:text-primary"
            aria-hidden="true"
          />
          <label htmlFor={searchId} className="sr-only">
            Scan a barcode or search products
          </label>
          <input
            id={searchId}
            type="text"
            autoComplete="off"
            // The counter's default focus: a shift starts with a scan, and a
            // scanner types into whatever holds the caret.
            // biome-ignore lint/a11y/noAutofocus: this box is the screen's purpose
            autoFocus
            disabled={disabled}
            value={draft}
            placeholder="Scan a barcode or search products"
            onChange={(event) => commit(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-3 focus-visible:outline-none disabled:opacity-50"
          />
          <span className="hidden flex-none rounded-[5px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-2 sm:inline">
            scanner ready
          </span>
        </div>

        {/*
          Offered only where it can actually work. `useCameraSupport` answers
          `null` until the first client effect — it reads `navigator` and
          `window`, and answering during render would decide for the server
          and then disagree with the client, which is a hydration mismatch on
          the one screen that must not flicker.

          A button that opens a camera and then silently never decodes is worse
          than no button, so an iPhone (no `BarcodeDetector`) and a phone on a
          plain-HTTP LAN address (no secure context) both get nothing here. The
          laser scanner and typing the barcode work everywhere and are what
          this field is for.
        */}
        {cameraSupport?.available ? (
          <button
            type="button"
            aria-label="Scan with the camera"
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
            className="flex size-[52px] flex-none items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <Camera className="size-5" aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="submit"
          aria-label="Search products"
          disabled={disabled}
          className="flex size-[52px] flex-none items-center justify-center rounded-[10px] border border-border bg-card text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <Search className="size-5" aria-hidden="true" />
        </button>
      </form>

      {/* A decoded barcode is committed exactly as a typed Enter is — same
          debounce skip, same single-match auto-add, same `scanMiss`. The
          camera is an input method, not a second lookup. */}
      <ScanSheet
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDecode={(value) => {
          setDraft(value);
          setScanMiss(null);
          if (timer.current) clearTimeout(timer.current);
          setSearch(value);
          setScanning(value);
        }}
      />

      {scanMiss !== null ? (
        // Announced, because the cashier is looking at the shelf and not at
        // the screen: silence after a beep reads as a successful scan.
        // `<output>` rather than a `<p role="status">` — it carries that role
        // implicitly, which is what biome's `useSemanticElements` asks for.
        <output className="block text-[13px] text-destructive-strong">
          Nothing matches that barcode or name. The search matches the start of
          a name, or a barcode exactly.
        </output>
      ) : null}

      <CategoryChips
        value={categoryId}
        onChange={setCategoryId}
        categories={categories.data ?? []}
        isLoading={categories.isPending}
        disabled={disabled}
      />

      {products.error ? (
        <ErrorCard
          error={products.error}
          title="Couldn't load the catalogue"
          // A 403 is not a failure retrying can fix — the role lost
          // `products:view` between renders.
          retry={
            products.error.status === 403
              ? undefined
              : () => {
                  void products.refetch();
                }
          }
        />
      ) : products.isPending ? (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
          {["a", "b", "c", "d", "e", "f"].map((cell) => (
            <Skeleton key={cell} className="h-[188px] rounded-[10px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={filtered ? "Nothing matches" : "No products yet"}
          description={
            filtered
              ? "The search matches the start of a name, or a barcode exactly. Try fewer characters or another category."
              : "Add what this business sells and it will show up here, ready to ring up."
          }
        />
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-2 gap-3.5 transition-opacity lg:grid-cols-3",
              // `keepPreviousData` holds the last grid on screen while the next
              // answer loads; dimming says so without blanking it.
              products.isPlaceholderData && "opacity-60",
            )}
          >
            {rows.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                currency={currency}
                onAdd={onAdd}
                disabled={disabled}
              />
            ))}
          </div>

          {total > rows.length ? (
            <p className="font-mono text-[11px] text-muted-2">
              {`Showing ${rows.length} of ${total} — scan or search to narrow it down.`}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

interface CategoryChipsProps {
  value: string;
  onChange: (categoryId: string) => void;
  categories: { id: string; name: string }[];
  isLoading: boolean;
  disabled?: boolean;
}

/**
 * The canvas's 36px chip row.
 *
 * Plain buttons rather than `role="tab"`: these control no panel, they narrow
 * one. (`products-page.tsx` uses tabs for a control that genuinely switches
 * panels — the two look identical and are not the same thing.)
 *
 * Nothing is rendered while the list is loading. A row of skeleton pills that
 * becomes a different width a beat later moves the whole grid down the screen,
 * which on a touch counter is a mis-tap.
 */
function CategoryChips({
  value,
  onChange,
  categories,
  isLoading,
  disabled,
}: CategoryChipsProps) {
  if (isLoading || categories.length === 0) return null;

  const chips = [{ id: ALL_CATEGORIES, name: "All" }, ...categories];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const selected = chip.id === value;
        return (
          <button
            key={chip.id || "all"}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(chip.id)}
            className={cn(
              "flex h-9 items-center rounded-lg border px-3.5 font-medium text-[13px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              selected
                ? "border-primary/30 bg-primary-soft text-primary-soft-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {chip.name}
          </button>
        );
      })}
    </div>
  );
}
