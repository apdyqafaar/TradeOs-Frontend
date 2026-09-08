import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";

const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Counter data changes while a shift is running, but not second to
        // second. Half a minute is long enough that navigating back to a list
        // is instant and short enough that a colleague's sale shows up soon.
        staleTime: 30_000,
        // Unused caches live five minutes so tab-switching between Products
        // and Sales does not refetch, then release the memory.
        gcTime: 5 * 60_000,
        // The counter runs alongside a calculator and a receipt printer
        // dialog; refetching every time the window regains focus turns each
        // alt-tab into a burst of requests for data that has not changed.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A 4xx is the server's considered answer, not a blip: a 401, 403,
          // 404, 409 or 422 will say exactly the same thing on the third try
          // while tripling the load and delaying the error the user needs.
          // (`ApiError` also uses status 0 for a dead network, which this
          // treats as final — a query can opt back in with its own `retry`.)
          if (isApiError(error) && error.status < 500) return false;
          return failureCount < 2;
        },
        // Errors belong in the component that asked for the data, as the
        // inline error card the brief specifies (§8.4), with the request id
        // on it. Throwing to an error boundary loses that context and blanks
        // the whole screen for one failed panel.
        throwOnError: false,
      },
      mutations: {
        // A mutation is a write. Replaying a failed `POST /sales` risks a
        // second sale and a second stock movement; nothing here is safe to
        // retry blindly, so retries are the caller's explicit decision.
        retry: false,
      },
    },
  });

/**
 * The browser's client, created once. Server renders never touch it.
 *
 * A module-level singleton would be shared by every concurrent server render,
 * which in a multi-tenant app means one business's prefetched data served to
 * another. Next's documented pattern is therefore a fresh client per server
 * render and one reused client in the browser (see
 * `node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/tanstack-query.md`).
 */
let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
