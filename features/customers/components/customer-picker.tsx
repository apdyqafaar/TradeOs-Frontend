"use client";

import { cn } from "cn";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import type { Customer } from "@/features/customers/types";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** `customers-page.tsx`'s figure, and for the same reason: one request per
 *  pause, not one per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

/** Enough to recognise the right row without turning the picker into a table. */
const RESULT_LIMIT = 8;

export interface CustomerPickerProps {
  /** The chosen customer, or `null`. The caller owns it; this never stores one. */
  value: Customer | null;
  /**
   * Fires with the whole row rather than an id, so a caller that needs the
   * name or the phone — a credit sale's confirmation, a payment's heading —
   * never re-fetches a customer it was just handed.
   */
  onChange: (customer: Customer) => void;
  /** The visible caption. Also names the result listbox. */
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Pick an existing customer — artboard `2a` (line 217) draws the chosen state:
 * a 48px row with the name over the phone and a terracotta "Change".
 *
 * **A caller without `customers:view` gets nothing at all**, not a disabled
 * box: `CLAUDE.md`'s rule is that a user without the permission sees nothing.
 * A screen that requires a customer — the counter's credit path — must gate
 * that whole path on the same permission rather than relying on this to
 * explain itself, because there is deliberately nothing here to read.
 *
 * The search half is a second component so `useCustomers` is only mounted
 * while somebody is actually looking. Returning early from one component
 * before the query hook would change the hook count between renders as the
 * session resolves.
 *
 * It knows nothing about sales or debts and calls neither's endpoints; the
 * only thing it reports is a `Customer`.
 */
export function CustomerPicker({
  value,
  onChange,
  label = "Customer",
  disabled,
  className,
}: CustomerPickerProps) {
  const canView = useCan(PERMISSIONS.CUSTOMERS_VIEW);
  const [changing, setChanging] = useState(false);

  if (!canView) return null;

  if (value !== null && !changing) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <span className="font-medium text-[13px] text-foreground">{label}</span>
        {/* Not a listbox and not a button: a static summary with one action in
            it. It carries no `role="group"` — the caption is the element
            immediately before it, which is how every other labelled value in
            this repo reads, and a group role here only adds a boundary
            announcement. */}
        <div className="flex h-12 items-center justify-between gap-3 rounded-[10px] border border-border bg-background px-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] text-foreground">
              {value.name}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {value.phone}
            </span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setChanging(true)}
            className="flex-none rounded-[6px] font-medium text-[12px] text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Change
            {/* Two pickers on one screen would otherwise both be "Change". */}
            <span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <CustomerSearch
      label={label}
      disabled={disabled}
      className={className}
      onPick={(customer) => {
        setChanging(false);
        onChange(customer);
      }}
      // Only offered when there is something to go back to.
      onCancel={value === null ? undefined : () => setChanging(false)}
    />
  );
}

interface CustomerSearchProps {
  label: string;
  disabled?: boolean;
  className?: string;
  onPick: (customer: Customer) => void;
  onCancel?: () => void;
}

/**
 * The combobox half, mounted only while picking.
 *
 * The list is always on screen rather than in a popover: this sits inside a
 * form panel that is already scrolling, and an inline list needs no outside
 * click handling, no focus trap and no portal to be usable.
 *
 * ARIA's combobox pattern — focus stays in the input and
 * `aria-activedescendant` names the highlighted option — rather than moving
 * DOM focus into the list, so the arrow keys never take the caret out of the
 * text the user is still editing.
 */
function CustomerSearch({
  label,
  disabled,
  className,
  onPick,
  onCancel,
}: CustomerSearchProps) {
  const uid = useId();
  const inputId = `${uid}-search`;
  const listId = `${uid}-list`;

  // What is in the box, and what has been committed to the query. They differ
  // for `SEARCH_DEBOUNCE_MS` after each keystroke.
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /*
   * `search` is dropped rather than sent empty: `listCustomersQuerySchema` is
   * `.strict()` with `search` at `min(1)`, so `?search=` is a 422 — on the
   * picker's opening state. An empty term therefore lists the first rows,
   * which is a useful "who do I sell to" list rather than a blank panel.
   *
   * `status` is explicit even though the backend defaults to it: an archived
   * customer is not someone a new sale or a payment should be attached to, and
   * saying so here means the request does not depend on a server default.
   */
  const results = useCustomers({
    limit: RESULT_LIMIT,
    status: "active",
    ...(search === "" ? {} : { search }),
  });

  const rows = results.data?.items ?? [];
  // A narrowed result can leave the highlight past the end of the list.
  const activeIndex =
    rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  const commit = (next: string) => {
    setDraft(next);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setSearch(next.trim()),
      SEARCH_DEBOUNCE_MS,
    );
  };

  const move = (delta: number) => {
    if (rows.length === 0) return;
    setActive((index) => (index + delta + rows.length) % rows.length);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={inputId}
          className="font-medium text-[13px] text-foreground"
        >
          {label}
        </label>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[6px] font-medium text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Cancel
          </button>
        ) : null}
      </div>

      <div className="flex h-12 items-center gap-2 rounded-[10px] border border-border bg-background px-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <Search
          className="size-[15px] flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          // Always expanded: the list is inline and never collapses, so
          // claiming otherwise would describe a control that is not there.
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex === -1 ? undefined : optionId(activeIndex)
          }
          autoComplete="off"
          disabled={disabled}
          value={draft}
          placeholder="Search name or phone"
          onChange={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              // Always prevented, even with nothing highlighted: this lives
              // inside the counter's form, and Enter here must never submit a
              // sale the shopkeeper was still choosing a customer for.
              event.preventDefault();
              const customer = rows[activeIndex];
              if (customer) onPick(customer);
            } else if (event.key === "Escape" && onCancel) {
              onCancel();
            }
          }}
          className="h-full w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50"
        />
      </div>

      {results.error ? (
        <ErrorCard
          error={results.error}
          title="Couldn't search customers"
          // A 403 is not a failure retrying can fix — the role lost
          // `customers:view` between renders — so no button is offered.
          retry={
            results.error.status === 403
              ? undefined
              : () => {
                  void results.refetch();
                }
          }
        />
      ) : (
        <div
          className={cn(
            "max-h-[240px] overflow-y-auto rounded-[10px] border border-border bg-card transition-opacity",
            // `keepPreviousData` holds the last rows on screen while the next
            // answer loads; dimming says so without blanking the list.
            results.isPlaceholderData && "opacity-60",
          )}
        >
          {results.isPending ? (
            // `<output>` rather than a div with `role="status"`: it carries
            // that role implicitly, so the polite live region announces the
            // wait without a redundant attribute.
            <output className="flex flex-col gap-2 px-3 py-2.5">
              <span className="sr-only">Searching customers</span>
              {["a", "b", "c"].map((row) => (
                <Skeleton key={row} className="h-7" />
              ))}
            </output>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-muted-foreground">
              {/* The backend matches a `^term` prefix against the lower-cased
                  name or the normalised phone
                  (`Backend/src/db/actions/customer.actions.ts:38-42`), so the
                  recovery is fewer characters — not a different spelling. */}
              No customer matches that. Search matches the start of a name or a
              phone number, so try fewer characters.
            </p>
          ) : (
            // Plain `div`s rather than `ul`/`li`: the roles below are the only
            // semantics in play, and a `ul` carrying an interactive role is
            // both a lint error and a second, contradictory announcement.
            <div
              id={listId}
              role="listbox"
              aria-label={`${label} results`}
              className="flex flex-col"
            >
              {rows.map((customer, index) => (
                // Every key is handled on the combobox input via
                // `aria-activedescendant`, which is the pattern's own
                // contract: an option that handled keys would need focus, and
                // focus belongs to the search box the user is still typing in.
                // The suppression has to be the last comment line — biome
                // attaches it to the line immediately below it, so an
                // explanation underneath silently disables it.
                // biome-ignore lint/a11y/useKeyWithClickEvents: see above
                <div
                  key={customer.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Focusable only by script, never by tab: the input keeps
                  // focus and points here with `aria-activedescendant`.
                  tabIndex={-1}
                  // Selecting on mouse-down would fire before the input's blur
                  // and is what makes a click land on the row under the
                  // pointer rather than the one the list just re-ordered.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(customer)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 border-border/60 border-b px-3 py-2.5 last:border-b-0",
                    index === activeIndex && "bg-muted",
                  )}
                >
                  <span className="truncate text-[14px] text-foreground">
                    {customer.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {customer.phone}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
