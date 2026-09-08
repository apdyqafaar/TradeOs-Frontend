import { cn } from "cn";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

interface SectionStripProps {
  /** Mono, uppercase, tracked. A noun: "Sales trend · last 7 days". */
  title: string;
  /**
   * One sentence explaining what the block counts. Rendered as a small info
   * icon with the sentence available to assistive technology and as a native
   * tooltip — deliberately not the `Tooltip` component, which would drag a
   * client boundary and a provider into every block that wants a footnote.
   */
  info?: string;
  /** The right-hand slot: a segmented control, a legend, a `…` menu. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The header-plus-body block every grouped panel on the Overview uses (design
 * canvas artboard `1c`): a muted header strip with a bottom rule, then the
 * content underneath with no padding of its own.
 *
 * The body is unpadded on purpose. A `DataTable` inside one must reach the
 * card's edges, while a chart carries its own 22/18px inset — padding here
 * would double up on one of them.
 */
export function SectionStrip({
  title,
  info,
  actions,
  children,
  className,
}: SectionStripProps) {
  return (
    <section
      data-slot="section-strip"
      className={cn(
        "overflow-hidden rounded-[10px] border border-border bg-card",
        className,
      )}
    >
      <header
        data-slot="section-strip-header"
        className="flex items-center justify-between gap-4 border-b border-border bg-muted px-[18px] py-2.5"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-[11px] font-medium tracking-[0.08em] text-foreground uppercase">
            {title}
          </h2>
          {info ? (
            <span
              className="inline-flex items-center text-muted-3"
              title={info}
            >
              <Info className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{info}</span>
            </span>
          ) : null}
        </div>

        {actions ? (
          <div className="flex items-center gap-3.5">{actions}</div>
        ) : null}
      </header>

      {children}
    </section>
  );
}
