import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import type { ListedMember } from "../types";
import { UNKNOWN_MEMBER, useMemberNames } from "./use-member-names";

const list = vi.fn();

vi.mock("../services/member.service", () => ({
  list: (...args: unknown[]) => list(...args),
}));

const OWNER_ID = "68c1f0a4e2b9c7d3a1f40b01";
const SELLER_ID = "68c1f0a4e2b9c7d3a1f40b02";
const PENDING_ID = "68c1f0a4e2b9c7d3a1f40b03";
const REINVITED_ID = "68c1f0a4e2b9c7d3a1f40b04";
const REMOVED_ID = "68c1f0a4e2b9c7d3a1f40b05";

/** An accepted member: populated `user`, no `invitedEmail` key at all. */
const active = (id: string, name: string): ListedMember => ({
  id,
  status: "active",
  joinedAt: "2026-08-01T09:00:00.000Z",
  createdAt: "2026-07-28T09:00:00.000Z",
  user: { id: `u-${id}`, name, email: `${name.toLowerCase()}@example.com` },
  role: { id: "r-seller", name: "Seller" },
});

/**
 * A pending invitation as it really arrives: `user` is an explicit `null` and
 * the address is the only identity there is. No `joinedAt` key.
 */
const pending = (id: string, email: string): ListedMember => ({
  id,
  status: "invited",
  invitedEmail: email,
  createdAt: "2026-09-01T09:00:00.000Z",
  user: null,
  role: { id: "r-seller", name: "Seller" },
});

const page = (
  items: ListedMember[],
  meta: Partial<Paginated<ListedMember>["meta"]> = {},
): Paginated<ListedMember> => ({
  items,
  meta: {
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: 1,
    ...meta,
  },
});

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const renderLookup = async () => {
  const view = renderHook(() => useMemberNames(), { wrapper: wrapper() });
  await waitFor(() => {
    expect(view.result.current.isLoading).toBe(false);
  });
  return view;
};

beforeEach(() => {
  list.mockReset();
});

describe("useMemberNames", () => {
  it("resolves an accepted member to their name", async () => {
    list.mockResolvedValue(page([active(OWNER_ID, "Amina")]));

    const { result } = await renderLookup();

    expect(result.current.resolve(OWNER_ID)).toBe("Amina");
    expect(result.current.display(OWNER_ID)).toBe("Amina");
  });

  it("resolves a pending member to their invited email, because there is no user yet", async () => {
    // `user` is null until the invitation is accepted — no `User` document
    // exists — so `invitedEmail` is the whole identity the API can offer.
    list.mockResolvedValue(page([pending(PENDING_ID, "leyla@spark.co.ke")]));

    const { result } = await renderLookup();

    expect(result.current.resolve(PENDING_ID)).toBe("leyla@spark.co.ke");
  });

  it("prefers the real name for a re-invited former member, who has both", async () => {
    // Re-inviting someone who was removed updates their EXISTING row and keeps
    // its `userId` (a second row would collide with the unique index at
    // acceptance and lock them out). So this row is `invited` WITH a populated
    // user and an invitedEmail — `status === "invited"` does not imply
    // `user === null`. Their name is the better identity of the two.
    list.mockResolvedValue(
      page([
        {
          ...active(REINVITED_ID, "Joseph"),
          status: "invited",
          invitedEmail: "joseph@spark.co.ke",
          joinedAt: undefined,
        },
      ]),
    );

    const { result } = await renderLookup();

    expect(result.current.resolve(REINVITED_ID)).toBe("Joseph");
  });

  it("cannot resolve a removed member, and the em dash stays correct", async () => {
    // THE limit worth knowing. `GET /members` filters removed rows out in the
    // query itself, there is no ?status= override and no GET /members/:id, so a
    // sale rung up by someone who has since left has nothing to join against.
    // The dash the sales table already renders is the honest answer; inventing
    // a name for a person the API will not name would be worse.
    list.mockResolvedValue(page([active(OWNER_ID, "Amina")]));

    const { result } = await renderLookup();

    expect(result.current.resolve(REMOVED_ID)).toBeNull();
    expect(result.current.display(REMOVED_ID)).toBe(UNKNOWN_MEMBER);
    expect(UNKNOWN_MEMBER).toBe("—");
  });

  it("walks every page, so member 101 is resolvable too", async () => {
    // The API caps `limit` at 100 and answers 422 for 101 — never a clamp — so
    // a single request cannot be assumed to be the whole directory.
    list
      .mockResolvedValueOnce(
        page([active(OWNER_ID, "Amina")], { page: 1, total: 2, totalPages: 2 }),
      )
      .mockResolvedValueOnce(
        page([active(SELLER_ID, "Barasa")], {
          page: 2,
          total: 2,
          totalPages: 2,
        }),
      );

    const { result } = await renderLookup();

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, { page: 1, limit: 100 });
    expect(list).toHaveBeenNthCalledWith(2, { page: 2, limit: 100 });
    expect(result.current.resolve(SELLER_ID)).toBe("Barasa");
  });

  it("degrades to the dash on a 403 instead of throwing", async () => {
    // A custom role without `members:view` gets a 403 here. Every preset holds
    // it — Seller included — so this is the narrow case, but a table that threw
    // would take down a screen whose subject is sales, not members.
    list.mockRejectedValue(
      new ApiError({
        message: "You do not have permission to do that",
        status: 403,
        code: "FORBIDDEN",
      }),
    );

    const { result } = await renderLookup();

    expect(result.current.isError).toBe(true);
    expect(result.current.resolve(OWNER_ID)).toBeNull();
    expect(result.current.display(OWNER_ID)).toBe(UNKNOWN_MEMBER);
  });

  it("answers null for a missing id without asking the map", async () => {
    list.mockResolvedValue(page([active(OWNER_ID, "Amina")]));

    const { result } = await renderLookup();

    expect(result.current.resolve(undefined)).toBeNull();
    expect(result.current.resolve(null)).toBeNull();
    expect(result.current.resolve("")).toBeNull();
    expect(result.current.display(undefined)).toBe(UNKNOWN_MEMBER);
  });

  it("omits a row it cannot name rather than resolving to an empty string", async () => {
    // Defensive: `user: null` with no `invitedEmail` is not reachable through
    // any documented path, but the two fields are independent on the wire and a
    // blank cell reads as a nameless person where the dash reads as an unknown
    // one.
    list.mockResolvedValue(
      page([{ ...pending(PENDING_ID, "x@y.z"), invitedEmail: undefined }]),
    );

    const { result } = await renderLookup();

    expect(result.current.resolve(PENDING_ID)).toBeNull();
  });
});
