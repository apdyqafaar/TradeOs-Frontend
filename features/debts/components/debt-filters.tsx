"use client";

import { cn } from "cn";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  DebtFilters,
  SetDebtFilters,
} from "@/features/debts/components/debt-status-tabs";
import {
  AMOUNT_RANGE_MESSAGES,
  amountRangeIssue,
} from "@/features/debts/lib/amount-range";
import { useOrganization } from "@/features/organization/hooks/use-organization";

/** Long enough that a name is not searched letter by letter, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

/** Matches the products bar, so the two filter strips are one control language. */
const CONTROL =
  "h-[38px] rounded-[10px] border border-border bg-card text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export interface DebtFiltersBarProps {
  filters: DebtFilters;
  setFilters: SetDebtFilters;
}

/**
 * The search box and amount range above the debts table.
 *
 * **Both narrow the server query, not the page.** `GET /debts` gained
 * `search`, `minAmount` and `maxAmount` on 2026-09-11; before that this screen
 * had no search at all, and the reason recorded in `debt-status-tabs.tsx` was
 * that a client-side filter over one page of twenty-five would confidently lie
 * about every other page. That reason has not gone away — it is why these are
 * query parameters.
 *
 * **The two ends of the range are debounced like the search**, and for the
 * same reason: typing "1500" would otherwise fire four requests, for 1, 15,
 * 150 and 1500, and the first three are answers nobody asked for.
 *
 * **An unusable range is shown, not sent.** `toDebtListParams` drops it, so the
 * table goes on showing the last good result while the message explains what to
 * fix — rather than blanking the screen or bouncing a 422 back through the
 * error card. The message sits under the boxes that caused it.
 *
 * The currency code is on the label rather than inside the inputs: the amount
 * is typed as a bare number, and a prefix inside the box invites someone to
 * type the code as well.
 */
export function DebtFiltersBar({ filters, setFilters }: DebtFiltersBarProps) {
  const { currency } = useOrganization();

  // What is in the boxes right now. The URL holds what has been committed.
  const [search, setSearch] = useState(filters.search);
  const [min, setMin] = useState(filters.minAmount);
  const [max, setMax] = useState(filters.maxAmount);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Adopt values that arrived from somewhere other than these boxes — the back
   * button, or the "Clear filters" action in the filtered-empty state — so the
   * bar never shows text that is no longer filtering anything. When the change
   * came from the debounce below these already match and React bails out.
   */
  useEffect(() => {
    setSearch(filters.search);
    setMin(filters.minAmount);
    setMax(filters.maxAmount);
  }, [filters.search, filters.minAmount, filters.maxAmount]);

  // A pending keystroke must not land after the component is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: Partial<DebtFilters>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Back to page 1: page 7 of the old result is not page 7 of the new one.
      void setFilters({ ...next, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  };

  const issue = amountRangeIssue(min, max);
  const anyFilter =
    search.trim() !== "" || min.trim() !== "" || max.trim() !== "";

  const clearAll = () => {
    if (timer.current) clearTimeout(timer.current);
    setSearch("");
    setMin("");
    setMax("");
    void setFilters({ search: "", minAmount: "", maxAmount: "", page: 1 });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className={cn(
            CONTROL,
            "flex min-w-[220px] flex-1 items-center gap-2 px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          )}
        >
          <Search
            className="size-[15px] flex-none text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              commit({ search: event.target.value });
            }}
            placeholder="Search by customer name"
            aria-label="Search debts by customer name"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-2"
          />
        </div>

        {/* A group, so a screen reader hears "Amount owed" once rather than
            reading two unrelated number boxes. */}
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">
            Amount owed, in {currency ?? "the business currency"}
          </legend>

          <span
            aria-hidden="true"
            className="text-[13px] text-muted-foreground"
          >
            Owes
          </span>

          <input
            type="text"
            inputMode="decimal"
            value={min}
            onChange={(event) => {
              setMin(event.target.value);
              commit({ minAmount: event.target.value });
            }}
            placeholder="Min"
            aria-label={`Smallest amount owed${currency ? ` in ${currency}` : ""}`}
            aria-invalid={issue !== null}
            className={cn(CONTROL, "w-[92px] px-2.5 text-right font-mono")}
          />

          <span
            aria-hidden="true"
            className="text-[13px] text-muted-foreground"
          >
            to
          </span>

          <input
            type="text"
            inputMode="decimal"
            value={max}
            onChange={(event) => {
              setMax(event.target.value);
              commit({ maxAmount: event.target.value });
            }}
            placeholder="Max"
            aria-label={`Largest amount owed${currency ? ` in ${currency}` : ""}`}
            aria-invalid={issue !== null}
            className={cn(CONTROL, "w-[92px] px-2.5 text-right font-mono")}
          />
        </fieldset>

        {anyFilter ? (
          <Button
            variant="ghost"
            onClick={clearAll}
            className="h-[38px] rounded-[10px] px-3 text-[13px] text-muted-foreground"
          >
            <X aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      {issue ? (
        <p role="alert" className="text-[12px] text-destructive-strong">
          {AMOUNT_RANGE_MESSAGES[issue]} Showing the last result until it is
          fixed.
        </p>
      ) : null}
    </div>
  );
}
