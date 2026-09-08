import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";

/**
 * There is no marketing site at `/`. An anonymous visitor bounces off
 * `/overview` again in `proxy.ts` and lands on `/login`, so the redirect is
 * correct for both signed-in and signed-out callers and costs no round trip.
 */
export default function RootPage() {
  redirect(ROUTES.overview);
}
