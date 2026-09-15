"use client";

import { cn } from "cn";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import {
  quietCopyFor,
  type SectionState,
} from "@/features/insights/lib/digest-shape";
import {
  figureDeltaClass,
  figureValueClass,
  formatDeltaPct,
  formatFigureValue,
} from "@/features/insights/lib/figures";
import type { SectionFigure, SectionKey } from "@/features/insights/types";

/**
 * One analyst's card: its numbers, its paragraph, and its own list.
 *
 * **The related page is a real `<Link>`, not a button and not a row that only
 * looks clickable.** 24 links in this codebase once shipped announced and keyed
 * as buttons, caught only in a real browser, and the strip's right-hand slot is
 * exactly the shape that invites the mistake again.
 *
 * On a phone the body collapses behind a one-line summary, which is what the
 * `1c` artboard draws — four full cards plus the actions list is a very long
 * scroll at 390px. It is a `useState` toggle with `hidden lg:flex` on the body
 * rather than a media query in JavaScript, so the desktop layout is decided by
 * CSS and never flashes collapsed on first paint.
 */

interface SectionCardProps {
  title: string;
  /** The live page this analyst's figures come from. Omitted where there is none. */
  link?: { href: string; label: string };
  figures?: SectionFigure[];
  /** ISO 4217 code from `useCurrencyConfig()`. `""` while it is still loading. */
  currency: string;
  /** The analyst's own sentence, set in the serif at 20px. */
  headline: string;
  points: string[];
  /**
   * Drawn above the figures — the seven-day bar chart on the sales card. A
   * slot rather than a `series` prop, so this component never has to know how
   * a chart is built or which tone it takes.
   */
  chart?: ReactNode;
  /** The card's own list — accounts to chase, lines to reorder, people. */
  children?: ReactNode;
}

export function SectionCard({
  title,
  link,
  figures,
  currency,
  headline,
  points,
  chart,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  const shown = figures?.slice(0, 4) ?? [];
  const lead = shown[0];

  return (
    <SectionStrip
      title={title}
      actions={
        link ? (
          <Link
            href={link.href}
            className="rounded-sm font-medium text-primary text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {link.label}
          </Link>
        ) : undefined
      }
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-[18px] py-3 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
      >
        {/* First, so the control's accessible name always starts with what it
            does and which card it belongs to — the visible text after it is
            content, and it changes with the state. */}
        <span className="sr-only">
          {open ? `Hide ${title} details` : `Show ${title} details`}
        </span>
        {open ? null : (
          <>
            <span className="min-w-0 flex-1 text-[13px] text-foreground leading-[1.45]">
              {headline}
            </span>
            {lead ? (
              <span
                className={cn(
                  "flex-none whitespace-nowrap font-medium font-mono text-[14px]",
                  figureValueClass(lead),
                )}
              >
                {formatFigureValue(lead, currency)}
              </span>
            ) : null}
          </>
        )}
        {open ? (
          <ChevronUp className="ml-auto size-4 text-muted-3" aria-hidden />
        ) : (
          <ChevronDown className="size-4 flex-none text-muted-3" aria-hidden />
        )}
      </button>

      <div
        id={bodyId}
        className={cn("flex-col", open ? "flex" : "hidden lg:flex")}
      >
        {chart}

        {shown.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3.5 border-border border-b px-[18px] py-4">
            {shown.map((figure) => (
              <div key={figure.label} className="flex flex-col gap-1">
                <dt className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
                  {figure.label}
                </dt>
                <dd
                  className={cn(
                    "font-medium font-mono text-[22px]",
                    figureValueClass(figure),
                  )}
                >
                  {formatFigureValue(figure, currency)}
                </dd>
                <FigureDelta figure={figure} />
              </div>
            ))}
          </dl>
        ) : null}

        <div className="flex flex-col gap-2.5 px-[18px] py-3.5">
          <p className="max-w-[720px] font-serif text-[20px] text-foreground text-pretty leading-[1.35]">
            {headline}
          </p>
          <Points items={points} />
        </div>

        {children}
      </div>
    </SectionStrip>
  );
}

/**
 * The comparison under a figure, in words as well as in colour: "+21.4% up on
 * the period before". `direction` is spelled out rather than drawn as an arrow
 * for the same reason the priority is a word.
 */
function FigureDelta({ figure }: { figure: SectionFigure }) {
  const delta = formatDeltaPct(figure.deltaPct);
  const direction =
    figure.direction === "up"
      ? "up"
      : figure.direction === "down"
        ? "down"
        : null;
  if (!delta && !direction) return null;

  return (
    <dd className="flex flex-wrap items-baseline gap-x-1.5">
      {delta ? (
        <span className={cn("font-mono text-[11px]", figureDeltaClass(figure))}>
          {delta}
        </span>
      ) : null}
      {direction ? (
        <span className="text-[11px] text-muted-foreground">{direction}</span>
      ) : null}
    </dd>
  );
}

/**
 * The analyst's bullet points.
 *
 * Keyed by index, not by the line itself: this text is written by a language
 * model, and a repeated line is not hypothetical — keying by content would
 * collide.
 */
function Points({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: model-written lines carry no id and this list is never reordered independently of the digest it belongs to; a repeated line must not collide.
        <li key={index} className="flex items-start gap-2.5">
          <span
            className="mt-[7px] size-[5px] flex-none rounded-full bg-primary"
            aria-hidden
          />
          <span className="text-[13px] text-foreground text-pretty leading-[1.55]">
            {line}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The header above a card's own list — "Chase first", "Reorder".
 *
 * Exported so each caller supplies its own words rather than the card guessing
 * them from a section key.
 */
export function SectionListLabel({ children }: { children: ReactNode }) {
  return (
    <span className="px-[18px] pb-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
      {children}
    </span>
  );
}

/**
 * A "**name** — why" row: `accountsToChase` and `reorder` share this shape.
 *
 * Keyed by index, not by name: two rows can legitimately name the same
 * customer for two different reasons, and the wire carries no id for either
 * beyond the name.
 */
export function WhyList({ rows }: { rows: { name: string; why: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col pb-2">
      {rows.map((row, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id beyond the customer/product name, which the model can legitimately repeat; this list is never reordered independently of the digest it belongs to.
          key={index}
          className="flex flex-col gap-0.5 border-border/60 border-t px-[18px] py-2.5"
        >
          <span className="font-medium text-[13px] text-foreground">
            {row.name}
          </span>
          <span className="text-[12px] text-muted-foreground text-pretty">
            {row.why}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What stands in for a section whose analyst did not finish.
 *
 * **It is a card in the section's own position, never a gap.** Hiding it would
 * make a partial run look like a complete one with fewer subjects, and the
 * reader would have no way to tell "the shelves are fine" from "nobody
 * looked". The dashed outline and the muted type say "this is absent" without
 * dressing it as an error: the sections that DID arrive are exactly as true as
 * they would be on a complete run.
 *
 * The link points at the live page, which is the honest alternative on offer —
 * the figures are still there, they simply have no analyst's sentence tonight.
 * The canvas draws a "Run again" link here; that would have to be a button (it
 * performs an action, it does not navigate), and the Generate control is
 * already in the page header, so this points at data instead.
 */
export function SectionNote({
  title,
  subject,
  state,
  quietKey,
  link,
}: {
  /** The card's label, matching the position it stands in for: "Team & projects". */
  title: string;
  /**
   * The analyst's name as it reads in a sentence — "team", not "Team &
   * projects". Passed rather than lower-cased from `title`, which produced
   * "The team & projects analyst did not finish tonight."
   */
  subject: string;
  state: SectionState;
  /**
   * Which section this stands in for, so the quiet sentence is looked up from
   * the copy table by `{reason, section}` rather than passed in as a string.
   *
   * Passing the finished sentence would have put the choice at five call sites
   * and made "which reason did we render this for?" invisible — and `reason` is
   * an enum that will grow.
   */
  quietKey: SectionKey;
  link?: { href: string; label: string };
}) {
  if (state.kind === "delivered") return null;
  const quiet = state.kind === "quiet";

  return (
    <div
      className={cn(
        "flex min-h-[56px] flex-col justify-center gap-1 rounded-[10px] px-5 py-3 sm:flex-row sm:items-center sm:gap-3",
        // Solid for quiet, dashed for failed. Both are muted and neither
        // carries a status colour: nothing has gone wrong in either case that
        // an owner can act on, and amber on a quiet Sunday is an alarm about
        // an ordinary day.
        quiet
          ? "border border-border"
          : "border border-surface-3 border-dashed",
      )}
    >
      <span className="flex-none font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
        {title}
      </span>
      <span className="flex-1 text-[13px] text-muted-foreground text-pretty">
        {state.kind === "quiet" ? (
          quietCopyFor(quietKey, state.reason)
        ) : (
          <>
            The {subject} analyst did not finish tonight.
            {link ? (
              <>
                {" "}
                Live figures are still on{" "}
                <Link
                  href={link.href}
                  className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {link.label}
                </Link>
                .
              </>
            ) : null}
            {state.reason ? (
              <span className="block text-[12px] text-muted-3">
                {state.reason}
              </span>
            ) : null}
          </>
        )}
      </span>
      {/* A quiet subject still gets its way in, as a plain trailing link that
          claims nothing about what is there. */}
      {quiet && link ? (
        <Link
          href={link.href}
          className="flex-none rounded-sm font-medium text-primary text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}
