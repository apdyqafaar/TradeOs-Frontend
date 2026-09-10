import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadKeys } from "@/features/uploads/keys";
import { projectKeys } from "../keys";
import type { Project, ProjectUpdate } from "../types";
import {
  useCreateProject,
  useCreateProjectUpdate,
  useDeleteProject,
  useDeleteProjectUpdate,
  useUpdateProject,
} from "./use-project-mutations";

const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const createUpdate = vi.fn();
const removeUpdate = vi.fn();
vi.mock("../services/project.service", () => ({
  create: (...args: unknown[]) => create(...args),
  update: (...args: unknown[]) => update(...args),
  remove: (...args: unknown[]) => remove(...args),
  createUpdate: (...args: unknown[]) => createUpdate(...args),
  removeUpdate: (...args: unknown[]) => removeUpdate(...args),
}));

const ID = "68b0000000000000000000a1";

const row = (overrides: Partial<Project> = {}): Project => ({
  id: ID,
  title: "Shopfront refit",
  description: null,
  customerId: null,
  status: "planned",
  progress: 0,
  startDate: null,
  dueDate: null,
  isPublished: false,
  publishedAt: null,
  cover: null,
  createdBy: "68b0000000000000000000b1",
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
  ...overrides,
});

const note = (overrides: Partial<ProjectUpdate> = {}): ProjectUpdate => ({
  id: "68b0000000000000000000e1",
  projectId: ID,
  body: "Framing done",
  progress: 40,
  createdBy: "68b0000000000000000000b1",
  createdAt: "2026-09-10T09:00:00.000Z",
  ...overrides,
});

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const removed: unknown[] = [];

  const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return realInvalidate(filters as never);
  }) as typeof queryClient.invalidateQueries;

  const realRemove = queryClient.removeQueries.bind(queryClient);
  queryClient.removeQueries = ((filters?: { queryKey?: unknown }) => {
    removed.push(filters?.queryKey);
    return realRemove(filters as never);
  }) as typeof queryClient.removeQueries;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper, invalidated, removed };
}

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  createUpdate.mockReset();
  removeUpdate.mockReset();
});

describe("useCreateProject", () => {
  it("seeds the detail entry and invalidates the lists and the gallery", async () => {
    create.mockResolvedValue(row());
    const { queryClient, wrapper, invalidated } = harness();
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    await act(async () => {
      result.current.mutate({ title: "Shopfront refit" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The 201 body comes from the same mapper the GET uses, so seeding it
    // invents nothing.
    expect(queryClient.getQueryData(projectKeys.detail(ID))).toEqual(row());
    expect(invalidated).toContainEqual(projectKeys.lists());
    // A cover, if there was one, has just left the unattached gallery.
    expect(invalidated).toContainEqual(uploadKeys.lists());
  });
});

describe("useUpdateProject", () => {
  it("seeds the detail entry and invalidates lists, because status moves rows", async () => {
    const updated = row({ status: "in_progress", progress: 40 });
    update.mockResolvedValue(updated);
    const { queryClient, wrapper, invalidated } = harness();
    const { result } = renderHook(() => useUpdateProject(), { wrapper });

    await act(async () => {
      result.current.mutate({ id: ID, input: { status: "in_progress" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(projectKeys.detail(ID))).toEqual(updated);
    expect(invalidated).toContainEqual(projectKeys.lists());
  });
});

describe("useDeleteProject", () => {
  it("removes the detail AND the notes, because the delete cascades", async () => {
    remove.mockResolvedValue(undefined);
    const { wrapper, invalidated, removed } = harness();
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    await act(async () => {
      result.current.mutate(ID);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // `removeQueries`, not `invalidateQueries`: invalidating would refetch an
    // id the server has just stopped serving and cache a 404 under it.
    expect(removed).toContainEqual(projectKeys.detail(ID));
    // Every update went with the project, in the same transaction.
    expect(removed).toContainEqual(projectKeys.updates(ID));
    expect(invalidated).toContainEqual(projectKeys.lists());
    expect(invalidated).toContainEqual(uploadKeys.lists());
  });
});

describe("useCreateProjectUpdate", () => {
  it("invalidates the project and the lists, not just the notes", async () => {
    // The one that surprises people: a note carrying `progress` writes that
    // value onto the PROJECT row in the same transaction
    // (`project.service.ts:291-294`), so a grid rendered a moment earlier is
    // showing a stale bar.
    createUpdate.mockResolvedValue(note());
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useCreateProjectUpdate(), { wrapper });

    await act(async () => {
      result.current.mutate({
        projectId: ID,
        input: { body: "Framing done", progress: 40 },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidated).toContainEqual(projectKeys.updates(ID));
    expect(invalidated).toContainEqual(projectKeys.detail(ID));
    expect(invalidated).toContainEqual(projectKeys.lists());
  });

  it("invalidates the same three even for a note with no progress", async () => {
    // Unconditional on purpose: distinguishing here would put the same rule in
    // two places and one of them would rot.
    createUpdate.mockResolvedValue(note({ progress: null }));
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useCreateProjectUpdate(), { wrapper });

    await act(async () => {
      result.current.mutate({ projectId: ID, input: { body: "Note" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidated).toContainEqual(projectKeys.detail(ID));
  });
});

describe("useDeleteProjectUpdate", () => {
  it("sends both ids and refreshes the project it may not have changed", async () => {
    removeUpdate.mockResolvedValue(undefined);
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useDeleteProjectUpdate(), { wrapper });

    await act(async () => {
      result.current.mutate({
        projectId: ID,
        updateId: "68b0000000000000000000e1",
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(removeUpdate).toHaveBeenCalledWith(ID, "68b0000000000000000000e1");
    expect(invalidated).toContainEqual(projectKeys.updates(ID));
    // NOT because the progress rolls back — it does not (contract §4.4) — but
    // so the screen shows whatever the server actually holds.
    expect(invalidated).toContainEqual(projectKeys.detail(ID));
  });
});
