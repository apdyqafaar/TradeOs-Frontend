import type { DashboardResponse } from "@/features/dashboard/types";
import { apiGet } from "@/lib/api/client";

/**
 * `GET /dashboard` — the entire Overview screen in one request.
 *
 * The endpoint takes no query parameters at all (`docs/API-ROUTES.md`) and is
 * gated on `organization:view`, which every member holds. The fine-grained
 * gating happens server-side per section, so the caller never asks for a
 * section and never has to know which ones it is entitled to. Nothing is
 * reshaped here: the interceptor has already unwrapped the envelope, and
 * `DashboardResponse` describes exactly what is left.
 */
export const getDashboard = (): Promise<DashboardResponse> =>
  apiGet<DashboardResponse>("/dashboard");
