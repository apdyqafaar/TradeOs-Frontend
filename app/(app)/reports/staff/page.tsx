import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { StaffReport } from "@/features/reports/components/staff-report";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Staff report",
};

/**
 * The staff report (design canvas artboard `2i`).
 *
 * Gated on `reports:view` alone, inherited from `/reports`. Note this is
 * **not** the same gate as the Overview's staff panel, which the backend
 * builds only for a caller holding `reports:view` **and** `members:view`
 * (`dashboard.service.ts`); `GET /reports/staff/sales` needs only the former,
 * and it carries every member's name itself.
 */
export default async function ReportsStaff() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <StaffReport />;
}
