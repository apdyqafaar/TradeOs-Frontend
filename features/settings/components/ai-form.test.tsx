import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiForm } from "./ai-form";

const mutate = vi.fn();
const refetch = vi.fn();

const loaded = {
  isLoading: false,
  error: null as {
    message: string;
    requestId?: string;
    status?: number;
  } | null,
  refetch,
  data: {
    id: "o1",
    name: "Shop",
    timezone: "Africa/Addis_Ababa",
    ai: { enabled: false, language: "en", hourLocal: 21 },
  } as object | undefined,
};

let profile = { ...loaded };

vi.mock("@/features/organization/hooks/use-organization-profile", () => ({
  useOrganizationProfile: () => profile,
}));
vi.mock("@/features/organization/hooks/use-organization-mutations", () => ({
  useUpdateAiSettings: () => ({
    mutate,
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}));

beforeEach(() => {
  mutate.mockClear();
  refetch.mockClear();
  profile = { ...loaded };
});

describe("AiForm", () => {
  it("shows the current settings, and names the business timezone beside the hour", () => {
    render(<AiForm />);
    expect(
      screen.getByRole("checkbox", { name: /daily digest/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: /language/i })).toHaveValue(
      "en",
    );
    expect(screen.getByRole("combobox", { name: /closing hour/i })).toHaveValue(
      "21",
    );
    expect(screen.getByText(/Africa\/Addis_Ababa/)).toBeInTheDocument();
  });

  it("submits only the fields that changed", async () => {
    render(<AiForm />);
    await userEvent.click(
      screen.getByRole("checkbox", { name: /daily digest/i }),
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /language/i }),
      "so",
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith(
      { enabled: true, language: "so" },
      expect.anything(),
    );
  });

  it("refuses to submit when nothing changed, and says why", async () => {
    render(<AiForm />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/change at least one/i)).toBeInTheDocument();
  });

  it("drops a field from the draft when it is set back to its saved value", async () => {
    // Toggling on and off again is not a change. Without this, the form posts
    // `{ enabled: false }` and the server writes a value it already held.
    render(<AiForm />);
    const toggle = screen.getByRole("checkbox", { name: /daily digest/i });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).not.toHaveBeenCalled();
  });
});

/**
 * A failed profile load must say so, with the request id.
 *
 * This tab used to render `if (profile.isLoading || !profile.data) return
 * <Skeleton/>` and nothing else, so a 500 — or an unreachable API, which the
 * client normalises to status 0 and the retry policy treats as final — left a
 * grey rectangle that never resolved: no message, no request id, no Try again.
 * Its two siblings in the same tab strip (`business-form.tsx`,
 * `currency-form.tsx`) both render an `ErrorCard` for the SAME failed query,
 * so one tab across from this one showed a proper error for the same failure.
 * The request id is the only thing support can work from.
 */
describe("AiForm — when the profile cannot be read", () => {
  it("renders the error with its request id instead of a skeleton that never resolves", () => {
    profile = {
      ...loaded,
      data: undefined,
      error: { message: "Something went wrong", requestId: "req_abc123" },
    };

    render(<AiForm />);

    expect(screen.getByRole("alert")).toHaveTextContent(/req_abc123/);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("offers Try again on a 500, and refetches when it is pressed", async () => {
    profile = {
      ...loaded,
      data: undefined,
      error: { message: "Server error", requestId: "req_1", status: 500 },
    };

    render(<AiForm />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(refetch).toHaveBeenCalled();
  });

  it("offers no Try again on a 403 — it answers the same however often it is asked", () => {
    profile = {
      ...loaded,
      data: undefined,
      error: { message: "Forbidden", requestId: "req_2", status: 403 },
    };

    render(<AiForm />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });
});
