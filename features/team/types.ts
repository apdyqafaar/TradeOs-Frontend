import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * The domain types `/members` and `/roles` return.
 *
 * Everything here is `docs/contracts/team.md`, which is `file:line` against the
 * backend. The one thing to carry away before reading further:
 *
 * **There are two member shapes on the wire and they are not the same object.**
 * `GET /members` rows (`ListedMember`) carry a populated `user` and `role` and
 * have **no `roleId`**. The four mutating endpoints answer `PublicMember`,
 * which has `roleId` as a bare string, **no `user` at all**, and `role` on only
 * two of the four. Splicing a mutation response into a list row blanks the
 * person's name. Refetch instead — see `hooks/use-member-mutations.ts`.
 * (`Backend/src/controller/member.controller.ts:14-21` vs `:72-88`.)
 */

/** `member.model.ts:8` — the enum, in full. `GET /members` never emits `removed`. */
export type MemberStatus = "active" | "invited" | "removed";

/** The person behind an accepted membership, populated on the listing only. */
export interface MemberUser {
  id: ObjectId;
  name: string;
  email: string;
  /** Omitted when the user never uploaded one. */
  image?: string;
}

/** The role reference on a member row: name only, never permissions. */
export interface MemberRoleRef {
  id: ObjectId;
  name: string;
}

/**
 * A row from `GET /members` — `listedMember`, `member.controller.ts:72-88`.
 *
 * `user` and `role` are explicit `null`s rather than absent keys; every other
 * optional field is an **omitted key**, because `JSON.stringify` drops
 * `undefined`. So an active member's row has no `invitedEmail` key at all and
 * an invited member's row has no `joinedAt`.
 *
 * `user === null` does **not** follow from `status === "invited"`. Re-inviting
 * someone who was removed updates their existing row in place and deliberately
 * keeps its `userId` (`member.actions.ts:155-169`), so that row comes back
 * `invited` **with** a populated `user` *and* an `invitedEmail`.
 * (`invite.test.ts:311-368`.)
 */
export interface ListedMember {
  id: ObjectId;
  /** Never `"removed"` here — the list filter excludes those rows entirely. */
  status: Exclude<MemberStatus, "removed">;
  /** Present only while invited. The pending member's whole identity. */
  invitedEmail?: string;
  /** ISO. Absent on an invited row. */
  joinedAt?: string;
  /** ISO. When the membership row was created — i.e. when they were invited. */
  createdAt: string;
  user: MemberUser | null;
  /** `null` only if the role document vanished; near-unreachable, render for it. */
  role: MemberRoleRef | null;
}

/**
 * What the four mutating member endpoints answer — `publicMember`,
 * `member.controller.ts:14-21`.
 *
 * `role` is appended by **invite (201)** and **update (200)** only; resend and
 * remove answer this bare. There is no `user` key on any of them, so this type
 * cannot name a person. It exists to be checked and discarded, not rendered.
 */
export interface PublicMember {
  id: ObjectId;
  status: MemberStatus;
  invitedEmail?: string;
  /** A bare id string, not a reference. The list shape has no such field. */
  roleId?: ObjectId;
  joinedAt?: string;
  createdAt: string;
  /** Invite and update only. */
  role?: MemberRoleRef;
}

/**
 * `GET /members` query parameters — `page` and `limit` and nothing else, and
 * the schema is `.strict()`, so an unknown key is a **422 rather than a
 * silently ignored filter** (`member.validation.ts:46-56`).
 *
 * There is deliberately no `status`, `search` or `roleId`: the filter is
 * hard-coded to `status: { $ne: "removed" }` (`member.actions.ts:21-24`) and
 * cannot be widened. A "former staff" view is not buildable against this API.
 */
export type MemberListParams = PaginationParams;

/**
 * A role — `publicRole`, `role.controller.ts:9-16`.
 *
 * `isCustom` and `isPreset` are two fields that always hold opposite values for
 * anything this API can create (`isPreset === !isCustom`); both are emitted.
 * Read either to decide whether to render edit affordances: the three presets
 * answer 403 `"Built-in roles cannot be changed"` to PATCH and DELETE alike.
 *
 * `permissions` is a flat array of `"resource:action"` strings — not a bitmask,
 * not nested. The Owner preset's array is the single element `["*"]`.
 */
export interface Role {
  id: ObjectId;
  name: string;
  /** Omitted key when unset, not an empty string. */
  description?: string;
  permissions: string[];
  isCustom: boolean;
  isPreset: boolean;
}
