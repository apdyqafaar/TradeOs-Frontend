"use client";

import { cn } from "cn";
import type { Debt } from "@/features/debts/types";
import { formatMoney } from "@/lib/format/money";

/**
 * A share of the principal, as a whole percent, for the bar only.
 *
 * **Nothing on this screen decides anything from this number.** It is a width
 * and a caption; every figure printed beside it is a server field rendered
 * verbatim. `principal <= 0` cannot happen through `POST /debts`
 * (`amount` is `.refine((n) => n > 0)`), but a sale-born debt is a path this
 * repo has not audited, so a zero would otherwise divide to `Infinity` and
 * blow the bar past its track.
 */
const share = (part: number, whole: number): number => {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
};

export interface DebtSummaryCardProps {
  debt: Debt;
  /**
   * The organization's main currency code, from `useOrganization()`.
   *
   * Required rather than defaulted: **a `Debt` carries no `currency` field at
   * all** (`../Backend/src/db/models/debt.model.ts` has none), so all four
   * amounts below are implicitly in the business's main currency and there is
   * nothing on the object to read it from. A hardcoded `"USD"` here would
   * render a Kenyan shop's ledger under the wrong code and look entirely
   * correct doing it.
   */
  currency: string;
}

/**
 * Principal · Paid · Remaining · Written off, over a progress bar — the panel
 * artboard `2g` draws at `docs/design/TradeOs-UI.dc.html:896-909`.
 *
 * **Every one of the four numbers is printed exactly as the server sent it.**
 * In particular `remaining` is a *stored* field mutated only by guarded atomic
 * updates, not `principal - paid`: the settlement tolerance (`remaining <=
 * 0.004` forces `status: "paid"` and `remaining` to exactly `0`) and the
 * payment overshoot tolerance (an overshoot of a cent or less is clamped to the
 * balance) are server-internal and never on the wire, so a subtraction here can
 * disagree with the API by a cent on the one screen whose entire job is saying
 * what someone is owed.
 *
 * The backend asserts `principal === paid + remaining + writtenOffAmount` after
 * every mutation (`debt.model.ts:9-14`), which is why the bar's two segments
 * are both taken as shares of `principal` — they can never sum past the track.
 */
export function DebtSummaryCard({ debt, currency }: DebtSummaryCardProps) {
  const paidShare = share(debt.paid, debt.principal);
  const writtenOffShare = share(debt.writtenOffAmount, debt.principal);

  return (
    <section className="flex flex-col gap-4 rounded-[10px] border border-border bg-card p-5">
      <h2 className="sr-only">Balance</h2>

      {/* Four across on a desktop, two on a phone — the artboard's
          `repeat(4,1fr)` at 720px wide would give each figure ~150px, and
          `USD 223.75` in 20px mono does not fit that at 375px. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          label="Principal"
          value={formatMoney(debt.principal, currency)}
        />
        <Figure
          label="Paid"
          value={formatMoney(debt.paid, currency)}
          // #4F8A5B in the canvas. `--success-strong` is that exact tone and is
          // documented as text on a soft tint, which is what this is.
          className="text-success-strong"
        />
        <Figure
          label="Remaining"
          value={formatMoney(debt.remaining, currency)}
          // The one figure the screen exists to answer, so it is the only one
          // drawn at full weight.
          className="font-medium text-foreground"
        />
        <Figure
          label="Written off"
          value={formatMoney(debt.writtenOffAmount, currency)}
          className="text-muted-2"
        />
      </div>

      <div className="flex items-center gap-3">
        {/*
          Decoration, not a widget: `role="progressbar"` would need an
          `aria-valuenow`, and biome's `useSemanticElements` asks for a
          `<progress>` element for that role anyway. The caption beside it
          already carries the same fact as text, so the bar is hidden from
          assistive technology rather than announced twice.
        */}
        <span
          aria-hidden="true"
          className="flex h-2 flex-1 overflow-hidden rounded-[4px] bg-muted"
        >
          <span
            className="h-2 bg-success-strong"
            style={{ width: `${paidShare}%` }}
          />
          {/*
            The canvas draws one segment, because it draws a debt with nothing
            written off. A written-off debt would otherwise show a bar that
            stops at 25% with no hint that the other 75% is never coming — so
            the leftover gets its own quiet segment. `writtenOffAmount` is the
            balance at the instant of write-off, not the principal.
          */}
          {writtenOffShare > 0 ? (
            <span
              className="h-2 bg-muted-3"
              style={{ width: `${writtenOffShare}%` }}
            />
          ) : null}
        </span>

        <span className="font-mono text-[12px] text-muted-foreground">
          {Math.round(paidShare)}% paid
          {writtenOffShare > 0
            ? ` · ${Math.round(writtenOffShare)}% written off`
            : ""}
        </span>
      </div>
    </section>
  );
}

interface FigureProps {
  label: string;
  value: string;
  className?: string;
}

/** One labelled amount: a 10px mono caption over a 20px mono figure. */
function Figure({ label, value, className }: FigureProps) {
  return (
    <div className="flex flex-col gap-[5px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className={cn("font-mono text-[20px] text-foreground", className)}>
        {value}
      </span>
    </div>
  );
}
