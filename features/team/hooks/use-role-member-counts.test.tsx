import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import type { ListedMember } from "../types";
import { useRoleMemberCounts } from "./use-role-member-counts";

const list = vi.fn();
vi.mock("../services/member.service", () => ({
  list: (...args: unknown[]) => list(...args),
}));

const member = (id: string, roleId: string | null): ListedMember => ({
  id,
  status: "active",
  joinedAt: "2026-08-01T09:00:00.000Z",
  createdAt: "2026-07-28T09:00:00.000Z",
  user: { id: `u-${id}`, name: `Person ${id}`, email: `${id}@example.com` },
  role: roleId ? { id: roleId, name: "Seller" } : null,
});

const page = (items: ListedMember[]): Paginated<ListedMember> => ({
  items,
  meta: { page: 1, limit: 100, total: items.length, totalPages: 1 },
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

const renderCounts = async () => {
  const view = renderHook(() => useRoleMemberCounts(), { wrapper: wrapper() });
  await waitFor(() => {
    expect(view.result.current.isLoading).toBe(false);
  });
  return view;
};

beforeEach(() => {
  list.mockReset();
});

describe("useRoleMemberCounts", () => {
  it("counts members per role from the list, because no endpoint carries it", () => {
    // `publicRole` is id, name, description, permissions, isCustom, isPreset —
    // and no count. The number beside a role on the roles screen is derived.
    list.mockResolvedValue(
      page([
        member("m1", "r-seller"),
        member("m2", "r-seller"),
        member("m3", "r-manager"),
      ]),
    );

    return renderCounts().then(({ result }) => {
      expect(result.current.countFor("r-seller")).toBe(2);
      expect(result.current.countFor("r-manager")).toBe(1);
      expect(result.current.countFor("r-clerk")).toBe(0);
    });
  });

  it("counts pending members too, which is what blocks a role deletion", async () => {
    // The delete guard counts `status: { $ne: "removed" }` — the same predicate
    // GET /members filters on — so an invited member who has never signed in
    // still stops the role being deleted. A count that ignored them would sit
    // next to a Delete button that 409s.
    list.mockResolvedValue(
      page([
        member("m1", "r-seller"),
        {
          ...member("m2", "r-seller"),
          status: "invited",
          user: null,
          invitedEmail: "leyla@spark.co.ke",
          joinedAt: undefined,
        },
      ]),
    );

    const { result } = await renderCounts();
    expect(result.current.countFor("r-seller")).toBe(2);
  });

  it("ignores a row whose role reference is missing", async () => {
    // Near-unreachable — a role held by a non-removed member cannot be deleted
    // — but `listedMember` guards for it, so this does too.
    list.mockResolvedValue(page([member("m1", null)]));

    const { result } = await renderCounts();
    expect(result.current.countFor("r-seller")).toBe(0);
  });

  it("reports isError so a caller can tell 'nobody' from 'unknown'", async () => {
    // `countFor` answers 0 in both cases. A confident 0 next to a Delete button
    // that then 409s is exactly what this flag exists to prevent.
    list.mockRejectedValue(
      new ApiError({
        message: "You do not have permission to do that",
        status: 403,
        code: "FORBIDDEN",
      }),
    );

    const { result } = await renderCounts();
    expect(result.current.isError).toBe(true);
    expect(result.current.countFor("r-seller")).toBe(0);
  });
});
