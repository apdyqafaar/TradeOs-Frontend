import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { ProjectListParams, ProjectUpdateListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the grid just keeps
 * showing the project that was deleted a moment ago.
 *
 * `lists` and `details` on `createQueryKeys` are readonly tuples, **not
 * functions** (`lib/query/keys.ts:19-23`); they are wrapped as functions here
 * only so every member of this object is called the same way at the use site.
 * The scaffolder's `keys.ts.template` writes `keys.lists()` against the raw
 * helper and does not compile — see `docs/findings/s2-task-01.md`.
 */
const keys = createQueryKeys("projects");

export const projectKeys = {
  /** Everything this slice caches. */
  all: keys.all,

  /**
   * Every page of the grid, under any status or customer filter.
   *
   * Invalidated by every write in the slice — **including posting a progress
   * note**. `POST /projects/:id/updates` carrying `progress` writes that value
   * onto the *project row* in the same transaction
   * (`project.service.ts:291-294`, contract §4.2), so a grid rendered a moment
   * earlier is showing a stale progress bar. That one is easy to miss because
   * the route reads like it only touches a sub-resource.
   *
   * Publish state lives on the project too — the "Published" pill in the
   * canvas is `project.isPublished` — so publish, unpublish and regenerate
   * invalidate this as well.
   */
  lists: () => keys.lists,

  /** One page. `params` is hashed into the key — hence `ProjectListParams` being flat. */
  list: (params: ProjectListParams) => keys.list({ ...params }),

  /** Every detail entry. */
  details: () => keys.details,

  /**
   * One project.
   *
   * Seeded from create and patch responses, which return the whole `Project`
   * from the same mapper the GET uses (`project.actions.ts:27-44`) — so writing
   * one there invents nothing.
   *
   * **Publish and friends do NOT return a `Project`.** They answer
   * `{ shareToken?, isPublished, publishedAt? }`, which is a different shape
   * with different keys; `unpublish` carries only `isPublished`. Those
   * mutations therefore invalidate this entry rather than seeding it — a
   * `setQueryData` built by spreading a `PublishResult` over a cached project
   * would write `shareToken` onto a `Project` that has no such field and, for
   * unpublish, would blank `publishedAt` to `undefined`.
   */
  detail: (id: ObjectId) => keys.detail(id),

  /**
   * A project's progress notes, under `["projects", "updates", id]` rather than
   * beneath `detail(id)`.
   *
   * Deliberate: the two are invalidated for different reasons at different
   * times, and nesting them would make every project refetch drag a page of
   * updates along with it. It also keeps `invalidateQueries({ queryKey:
   * projectKeys.detail(id) })` from silently discarding the updates list.
   *
   * Both branches share the `["projects"]` prefix, so
   * `invalidateQueries({ queryKey: projectKeys.all })` still reaches everything.
   */
  updates: (projectId: ObjectId) => ["projects", "updates", projectId] as const,
  updateList: (projectId: ObjectId, params: ProjectUpdateListParams) =>
    ["projects", "updates", projectId, { ...params }] as const,
} as const;
