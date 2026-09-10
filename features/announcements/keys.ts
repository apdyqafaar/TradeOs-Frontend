import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { AnnouncementListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the feed just keeps
 * showing the notice that was deleted a moment ago. So nothing here is
 * hand-written at a call site.
 *
 * `lists` and `details` on `createQueryKeys` are readonly tuples, **not
 * functions** (`lib/query/keys.ts:19-23`); they are wrapped as functions here
 * only so every member of this object is called the same way at the use site.
 * The scaffolder's `keys.ts.template` writes `keys.lists()` against the raw
 * helper and does not compile — see `docs/findings/s2-task-01.md`.
 */
const keys = createQueryKeys("announcements");

export const announcementKeys = {
  /** Everything this slice caches. */
  all: keys.all,

  /**
   * Every page of the feed.
   *
   * **Every write in this slice invalidates this, pin included**, and the
   * reason is the ordering: the list is sorted `{ pinned: -1, createdAt: -1 }`
   * *before* it is paginated, so pinning a notice moves it to the head of page
   * 1 and pushes the oldest row on that page onto page 2. No cached page can be
   * patched to match — a `setQueryData` that flipped `pinned` in place would
   * leave the row where it was and quietly disagree with the server about what
   * page 2 contains.
   */
  lists: () => keys.lists,

  /** One page. `params` is hashed into the key — hence `AnnouncementListParams` being flat. */
  list: (params: AnnouncementListParams) => keys.list({ ...params }),

  /** Every detail entry. */
  details: () => keys.details,

  /**
   * One announcement.
   *
   * Seeded from create and patch responses, which return the whole
   * `Announcement` from the same mapper the GET uses
   * (`announcement.actions.ts:46-72`) — so writing one there invents nothing.
   */
  detail: (id: ObjectId) => keys.detail(id),
} as const;
