import type { AiLanguage } from "@/features/organization/types";

/**
 * The domain shapes `/digests/*` returns.
 *
 * Taken verbatim from Task F1's brief, which mirrors the backend's digest
 * shapers — no field here is guessed from a name.
 */

export type DigestStatus = "complete" | "partial" | "failed";
export type StoppedBy = "complete" | "budget" | "hops" | "error";
export type SectionKey =
  | "sales"
  | "debts"
  | "stock"
  | "team"
  | "recommendations";

export interface SalesSection {
  headline: string;
  points: string[];
  comparison: { vsLastWeek: string; monthToDate: string };
  anomalies: string[];
}
export interface DebtsSection {
  headline: string;
  points: string[];
  accountsToChase: { customer: string; why: string }[];
}
export interface StockSection {
  headline: string;
  points: string[];
  reorder: { product: string; why: string }[];
}
export interface TeamSection {
  headline: string;
  people: string[];
  projects: string[];
}
export interface RecommendationAction {
  priority: "high" | "medium" | "low";
  kind: "chase" | "restock" | "review" | "promote" | "project" | "other";
  text: string;
}
export interface RecommendationsSection {
  actions: RecommendationAction[];
  warnings: string[];
}
export interface DigestSections {
  sales: SalesSection | null;
  debts: DebtsSection | null;
  stock: StockSection | null;
  team: TeamSection | null;
  recommendations: RecommendationsSection | null;
}

/** One tool call an analyst made — parameters, a one-line summary, and the capped result it saw. */
export interface ToolTrace {
  seq: number;
  agent: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  output: unknown;
  ms: number;
}

export interface DigestSummary {
  id: string;
  localDate: string;
  timezone: string;
  language: AiLanguage;
  model: string;
  trigger: "cron" | "manual";
  requestedBy?: string;
  status: DigestStatus;
  stoppedBy: StoppedBy;
  sections: DigestSections;
  errors: { section: SectionKey; message: string }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    calls: number;
    routerCalls: number;
    costUsd: number;
  };
  generatedAt: string;
  createdAt: string;
}
export interface Digest extends DigestSummary {
  trace: ToolTrace[];
}
export interface RunDigestResult {
  localDate: string;
}
