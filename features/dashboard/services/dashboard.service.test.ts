import { describe, expect, it, vi } from "vitest";
import { getDashboard } from "./dashboard.service";

vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
  return { ...actual, apiGet: vi.fn() };
});

describe("getDashboard", () => {
  it("requests the dashboard and returns the envelope's data unchanged", async () => {
    const { apiGet } = await import("@/lib/api/client");
    const payload = {
      available: ["organization", "me", "sales"],
      sections: { team: { activeCount: 4, invitedCount: 1 } },
    };
    vi.mocked(apiGet).mockResolvedValue(payload);

    await expect(getDashboard()).resolves.toEqual(payload);
    expect(apiGet).toHaveBeenCalledWith("/dashboard");
  });
});
