import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiForm } from "./ai-form";

const mutate = vi.fn();
vi.mock("@/features/organization/hooks/use-organization-profile", () => ({
  useOrganizationProfile: () => ({
    isLoading: false,
    data: {
      id: "o1",
      name: "Shop",
      timezone: "Africa/Addis_Ababa",
      ai: { enabled: false, language: "en", hourLocal: 21 },
    },
  }),
}));
vi.mock("@/features/organization/hooks/use-organization-mutations", () => ({
  useUpdateAiSettings: () => ({
    mutate,
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}));

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
