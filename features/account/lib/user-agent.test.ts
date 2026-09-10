import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent";

/**
 * The API returns the raw `userAgent` and does no parsing at all, so this is
 * the only thing between a session row and a 120-character string.
 *
 * The tests that matter are the impostor cases: Edge sends a UA containing
 * `Chrome` *and* `Safari`, and Chrome sends one containing `Safari`. Getting
 * the order wrong labels every Edge session "Chrome", which is exactly the kind
 * of confident wrong answer that makes somebody dismiss a session that is not
 * theirs.
 */
describe("describeUserAgent", () => {
  it("prefers the most specific token when browsers impersonate each other", () => {
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(describeUserAgent(edge).label).toBe("Edge · Windows");

    const chrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(describeUserAgent(chrome).label).toBe("Chrome · Windows");

    const opera =
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0";
    expect(describeUserAgent(opera).label).toBe("Opera · Windows");
  });

  it("reads the common mobile and desktop combinations", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
      ).label,
    ).toBe("Safari · iPhone");

    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ).label,
      // Android is checked before Linux, which every Android UA also contains.
    ).toBe("Chrome · Android");

    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:121.0) Gecko/20100101 Firefox/121.0",
      ).label,
    ).toBe("Firefox · macOS");
  });

  it("returns the raw string and no label when it cannot tell", () => {
    // A guess would be worse than the truth: the person reading this list is
    // trying to recognise a device, and "Unknown browser" helps nobody.
    const odd = "SomeInternalTool/2.0";
    expect(describeUserAgent(odd)).toEqual({ label: null, raw: odd });
  });

  it("gives back half a label rather than none", () => {
    const result = describeUserAgent("curl/8.4.0 (Windows NT 10.0)");
    expect(result.label).toBe("Windows");
    expect(result.raw).toBe("curl/8.4.0 (Windows NT 10.0)");
  });

  it("handles the null the API can genuinely send", () => {
    // `userAgent` is nullable on `GET /auth/sessions`, and so is `ipAddress`.
    expect(describeUserAgent(null)).toEqual({ label: null, raw: null });
    expect(describeUserAgent("   ")).toEqual({ label: null, raw: null });
  });
});
