"use client";

import { cn } from "cn";
import { useId, useState } from "react";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { PriorityPill } from "@/features/insights/components/digest-status";
import { actionsSummary } from "@/features/insights/lib/digest-shape";
import type { Digest } from "@/features/insights/types";

/**
 * "What to do tomorrow" — the largest block on the page, and the reason the
 * page exists. Numbers tell an owner what happened; this tells them what to do
 * about it.
 *
 * Each row is priority-as-a-word, the kind of work, and the sentence. The
 * priority is a **word** and never a colour alone: `{high, chase, "Call Hodan
 * Traders"}` and `{low, chase, "Call Juma Kiosk"}` used to announce
 * identically and differ only in hue, on the one card whose entire purpose is
 * ranking (WCAG 1.4.1).
 *
 * The canvas draws a chevron at the end of every row, implying each one opens
 * something. **It does not, so there is none here.** An action is
 * model-written text with no id and no destination — `RecommendationAction` is
 * `{priority, kind, text}` — and a chevron that navigates nowhere is worse
 * than no chevron.
 */
export function ActionsCard({ digest }: { digest: Digest }) {
  const actions = digest.sections.recommendations?.actions ?? [];
  const warnings = digest.sections.recommendations?.warnings ?? [];
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const uid = useId();

  return (
    <SectionStrip
      title="What to do tomorrow"
      info="Written by the advisor from the four analysts' reports."
      actions={
        <span className="font-mono text-[11px] text-muted-foreground">
          {actionsSummary(digest)}
        </span>
      }
    >
      <ol className="flex flex-col">
        {actions.map((action, index) => {
          // Position is the identity. Nothing in the advisor's prompt stops
          // the model emitting the same {kind, text} twice, and keying by
          // content made that two identical React keys in one <ol> — a console
          // error and unstable reconciliation on the next poll tick.
          const id = `${uid}-${index}`;
          const checked = done.has(index);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: an action is model-written text with no id, the same {kind, text} can legitimately appear twice, and this list is never reordered independently of the digest it belongs to.
              key={index}
              className="flex items-start gap-3.5 border-border/60 border-b px-[18px] py-4 last:border-b-0"
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setDone((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
                className="mt-0.5 size-[22px] flex-none cursor-pointer rounded-md border border-border-strong bg-card accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityPill priority={action.priority} />
                  <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
                    {action.kind}
                  </span>
                </div>
                {/* The label, so the whole sentence is the checkbox's own
                    accessible name — "Call Nasra Ali about USD 380.75" rather
                    than thirty controls all called "checkbox". */}
                <label
                  htmlFor={id}
                  className={cn(
                    "cursor-pointer text-[15px] text-foreground text-pretty leading-[1.45]",
                    checked && "text-muted-foreground line-through",
                  )}
                >
                  {action.text}
                </label>
              </div>
            </li>
          );
        })}
      </ol>

      {actions.length === 0 ? (
        <p className="px-[18px] py-4 text-[13px] text-muted-foreground">
          The advisor found nothing that needs doing tomorrow.
        </p>
      ) : (
        /* Ticking one is a reading aid, not a record. There is no endpoint
           that stores it, and an owner who ticks four items at 21:00 and finds
           them all back in the morning would be right to call that broken — so
           the card says what the tick is before they rely on it. */
        <p className="px-[18px] py-2.5 font-mono text-[11px] text-muted-2">
          Ticks are for reading tonight — nothing is saved.
        </p>
      )}

      {warnings.length > 0 ? (
        <div className="flex flex-col gap-2 border-border border-t px-[18px] py-3.5">
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
            Worth knowing
          </span>
          <ul className="flex flex-col gap-2">
            {warnings.map((warning, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: model-written lines with no id; a repeated warning ("batteries running low" twice) must not collide.
                key={index}
                className="flex items-start gap-2.5 text-[13px] text-foreground leading-[1.55]"
              >
                <span
                  className="mt-[7px] size-[5px] flex-none rounded-full bg-warning"
                  aria-hidden
                />
                <span className="text-pretty">{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionStrip>
  );
}
