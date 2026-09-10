import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicProject } from "./public-project.service";

/** A well-formed token: 64 lowercase hex characters. */
const TOKEN = "a3f".padEnd(64, "0");

const payload = {
  business: { name: "Hodan Hardware", logo: null },
  project: {
    title: "Storefront build",
    description: "New signage and paint",
    status: "in_progress",
    progress: 40,
    startDate: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-09-10T09:00:00.000Z",
    cover: { url: "https://x/c.webp", thumbUrl: "https://x/c-t.webp" },
  },
  updates: [
    {
      body: "Framing done",
      progress: 40,
      createdAt: "2026-09-09T09:00:00.000Z",
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (status: number, body: unknown) => {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
};

describe("fetchPublicProject", () => {
  it("returns the payload on a 200", async () => {
    respond(200, { success: true, message: "Project fetched", data: payload });

    const result = await fetchPublicProject(TOKEN);
    expect(result?.project.title).toBe("Storefront build");
    expect(result?.updates).toHaveLength(1);
    expect(result?.business.logo).toBeNull();
  });

  it("asks the API origin directly, with no-store and no credentials", async () => {
    respond(200, { success: true, message: "ok", data: payload });
    await fetchPublicProject(TOKEN);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/public/projects/${TOKEN}`);
    // The route's own response is `Cache-Control: no-store`, and an unpublish
    // takes effect instantly — a cached page would serve a revoked project.
    expect(init.cache).toBe("no-store");
    // The route has no auth chain at all; forwarding a reader's cookies to it
    // would be sending a session somewhere it is not needed.
    expect(init.credentials).toBeUndefined();
  });

  it("refuses a badly shaped token without spending a request", async () => {
    // The rate limit is 60/min keyed on the caller's IP — and because this
    // call originates on the Next server, that bucket is shared by every
    // visitor to every share link. A crawler walking garbage tokens must not
    // burn it on answers that are knowable locally.
    for (const bad of [
      "",
      "abc",
      "A".repeat(64), // correctly hex but UPPER-cased: the API 404s it
      "g".repeat(64), // not hex
      "a".repeat(65),
      "a".repeat(200), // over 128 chars: a 422 on the API, not a 404
    ]) {
      expect(await fetchPublicProject(bad)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers null for every failure, without distinguishing them", async () => {
    // The API's 404 bodies are byte-identical across a wrong token, a
    // malformed one and a never-issued one (`public-link.test.ts:168-191`).
    // Branching on status here would re-introduce the oracle it removed.
    for (const status of [404, 422, 429, 500, 503]) {
      respond(status, { success: false, message: "Project not found" });
      expect(await fetchPublicProject(TOKEN)).toBeNull();
    }
  });

  it("answers null when the connection fails or the body is not JSON", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchPublicProject(TOKEN)).toBeNull();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    expect(await fetchPublicProject(TOKEN)).toBeNull();
  });

  it("rejects a 200 that is not shaped like a project", async () => {
    // An HTML error page from a proxy or a backend mid-deploy is not a licence
    // to render a project page.
    respond(200, { success: true, data: { business: {}, project: {} } });
    expect(await fetchPublicProject(TOKEN)).toBeNull();

    respond(200, { success: false, data: payload });
    expect(await fetchPublicProject(TOKEN)).toBeNull();

    respond(200, "<!doctype html>");
    expect(await fetchPublicProject(TOKEN)).toBeNull();
  });

  it("accepts an empty business name — the org row being gone is still a 200", async () => {
    respond(200, {
      success: true,
      data: { ...payload, business: { name: "", logo: null } },
    });
    const result = await fetchPublicProject(TOKEN);
    expect(result?.business.name).toBe("");
  });

  it("keeps progress: 0 and normalises a missing progress to null", async () => {
    respond(200, {
      success: true,
      data: {
        ...payload,
        updates: [
          { body: "Reset", progress: 0, createdAt: "2026-09-09T09:00:00.000Z" },
          { body: "Note", createdAt: "2026-09-08T09:00:00.000Z" },
        ],
      },
    });

    const result = await fetchPublicProject(TOKEN);
    expect(result?.updates[0]?.progress).toBe(0);
    expect(result?.updates[1]?.progress).toBeNull();
  });

  it("drops an unrenderable update rather than losing the whole page", async () => {
    respond(200, {
      success: true,
      data: {
        ...payload,
        updates: [
          { progress: 10 },
          {
            body: "Real",
            progress: null,
            createdAt: "2026-09-08T09:00:00.000Z",
          },
        ],
      },
    });

    const result = await fetchPublicProject(TOKEN);
    expect(result?.updates).toHaveLength(1);
    expect(result?.updates[0]?.body).toBe("Real");
  });

  it("rejects a status outside the enum", async () => {
    respond(200, {
      success: true,
      data: { ...payload, project: { ...payload.project, status: "archived" } },
    });
    expect(await fetchPublicProject(TOKEN)).toBeNull();
  });
});
