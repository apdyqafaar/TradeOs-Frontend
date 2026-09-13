import { TraceView } from "@/features/insights/components/trace-view";
import type { Digest } from "@/features/insights/types";

/**
 * The audit block under every digest: how much work the analysts did, and the
 * trace of every question they asked.
 *
 * One component rather than a copy on `/insights` and another on
 * `/insights/:id`. The two were identical — same `<section>`, same heading with
 * the same four utility classes, same three-number sentence, same
 * `<TraceView>` — which is exactly the shape the bare-date bug had before
 * `formatLocalDate` was extracted: change the wording once, or add a fourth
 * number, and the two pages start describing the same digest differently.
 */
export function TraceSection({ digest }: { digest: Digest }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
        What the analysts looked at
      </h2>
      <p className="font-mono text-[11px] text-muted-2">
        {digest.usage.calls} analyst turns · {digest.usage.routerCalls} routing
        decisions · {digest.trace.length} tool calls
      </p>
      <TraceView trace={digest.trace} />
    </section>
  );
}
