"use client";

import { useSyncExternalStore } from "react";
import type { ObjectId } from "@/lib/api/types";
import { getShareToken, subscribeToShareTokens } from "../share-token-store";

/**
 * The share token this tab is holding for a project, or `undefined`.
 *
 * `useSyncExternalStore` rather than `useState` seeded from the store: the
 * publish mutation writes the token from its own `onSuccess`, and more than one
 * thing on the detail screen can read it. A `useState` copy would be a second
 * source of truth that stays right only for as long as nobody adds a third
 * reader.
 *
 * **`getServerSnapshot` is `undefined` and that is correct, not a stub.** The
 * server has never seen this value — it exists only in the browser heap of the
 * tab that performed the publish — so the pre-hydration render is genuinely
 * "no token here", and the share card's "the link cannot be shown" copy is the
 * honest thing to paint first.
 */
export function useShareToken(projectId: ObjectId): string | undefined {
  return useSyncExternalStore(
    subscribeToShareTokens,
    () => getShareToken(projectId),
    () => undefined,
  );
}
