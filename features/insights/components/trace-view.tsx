import type { ToolTrace } from "@/features/insights/types";

/**
 * The audit trail: which questions each analyst asked, in order, and what it
 * was shown. Parameters and results are rendered as JSON text — never
 * interpreted — so a product named like an instruction is just a string here.
 */
export function TraceView({ trace }: { trace: ToolTrace[] }) {
  if (trace.length === 0)
    return (
      <p className="text-[13px] text-muted-foreground">
        No tool calls were recorded for this digest.
      </p>
    );
  return (
    <ol className="flex flex-col divide-y divide-border rounded-[12px] border border-border bg-card">
      {trace.map((t) => (
        <li key={t.seq} className="flex flex-col gap-1 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
            <span className="font-mono text-[11px] text-muted-3">{t.seq}</span>
            <span className="font-medium text-foreground">{t.agent}</span>
            <span className="font-mono text-xs text-primary">{t.tool}</span>
            <span className="text-muted-foreground">{t.summary}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-3">
              {t.ms} ms
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Parameters and result
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-foreground leading-relaxed">
              {JSON.stringify({ input: t.input, output: t.output }, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
}
