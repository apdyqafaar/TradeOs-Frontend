import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearShareTokens, rememberShareToken } from "../share-token-store";
import type { Project } from "../types";
import { ShareCard } from "./share-card";

// The three publish routes are exercised by `use-project-publish.test.tsx`.
// This file is about what the card SAYS in each of its four states, so the
// network is stubbed out entirely.
vi.mock("../services/project.service", () => ({
  publish: vi.fn(),
  unpublish: vi.fn(),
  regenerateLink: vi.fn(),
}));

const ID = "68b0000000000000000000a1";
const TOKEN = "a".repeat(64);

const row = (overrides: Partial<Project> = {}): Project => ({
  id: ID,
  title: "Shopfront refit",
  description: null,
  customerId: null,
  status: "in_progress",
  progress: 40,
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

function draw(project: Project) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ShareCard project={project} timezone="Africa/Nairobi" />, {
    wrapper,
  });
}

beforeEach(() => {
  clearShareTokens();
});

describe("ShareCard — state 1, never published", () => {
  it("offers one action and says what a client will be able to see", () => {
    draw(row());
    expect(
      screen.getByRole("button", { name: /publish and get the link/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unpublish/i })).toBeNull();
    // No URL of any kind before one exists.
    expect(screen.queryByLabelText(/public link/i)).toBeNull();
  });
});

describe("ShareCard — state 2, published and this tab holds the token", () => {
  it("shows the whole URL, selectable, with a copy control", () => {
    rememberShareToken(ID, TOKEN);
    draw(row({ isPublished: true }));

    const field = screen.getByLabelText(
      /public link for this project/i,
    ) as HTMLInputElement;
    // Built from the configured app origin, not from whatever host this member
    // happens to be on — the URL is going into a message to somebody else.
    expect(field.value).toBe(`http://localhost:3000/p/${TOKEN}`);
    // `readOnly`, not `disabled`: a disabled input cannot be selected, and
    // selecting it by hand is the fallback when the clipboard API is refused.
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: /copy link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });
});

describe("ShareCard — state 3, published but the token is not in this tab", () => {
  it("renders no link at all rather than a placeholder or a guess", () => {
    draw(row({ isPublished: true }));

    expect(screen.queryByLabelText(/public link/i)).toBeNull();
    expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
    // Nothing that looks like a URL, invented or stale.
    expect(screen.queryByText(/localhost:3000\/p\//)).toBeNull();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
  });

  it("says the client's link still works — it is this screen that cannot show it", () => {
    draw(row({ isPublished: true }));
    expect(
      screen.getByText(/the link still works for anyone holding it/i),
    ).toBeInTheDocument();
    // The recovery, with its price named.
    expect(
      screen.getByRole("button", { name: /create a new link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the one the client has will stop working/i),
    ).toBeInTheDocument();
  });
});

describe("ShareCard — state 4, unpublished after being published", () => {
  it("labels publishedAt as a past event, never as current state", () => {
    // `publishedAt` survives an unpublish and means "last published at"
    // (contract §3.2). Calling it "Published" beside a project that is not
    // would be exactly wrong.
    draw(row({ isPublished: false, publishedAt: "2026-09-10T09:00:00.000Z" }));
    expect(screen.getByText(/last shared/i)).toBeInTheDocument();
    expect(
      screen.getByText(/turns the previous link back on/i),
    ).toBeInTheDocument();
  });

  it("does not mention a previous link when there never was one", () => {
    draw(row());
    expect(screen.queryByText(/last shared/i)).toBeNull();
    expect(screen.queryByText(/turns the previous link back on/i)).toBeNull();
  });
});
