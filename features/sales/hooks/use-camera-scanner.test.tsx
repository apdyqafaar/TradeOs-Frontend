import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCameraScanner } from "./use-camera-scanner";

/**
 * `BarcodeDetector` and `getUserMedia` do not exist in happy-dom, and that is
 * the point of these tests rather than an obstacle: what is worth protecting
 * is the logic AROUND the browser APIs — that the tracks are always given back
 * and that one barcode held in front of the lens is one line on the receipt.
 * Both are invisible in a browser until a shopkeeper notices the camera light
 * staying on or the receipt showing eleven tins.
 */

const stopTrack = vi.fn();

/** A MediaStream stand-in whose tracks record being stopped. */
function fakeStream() {
  const track = {
    stop: stopTrack,
    getCapabilities: () => ({}),
    applyConstraints: vi.fn(),
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

/** Frames the detector will report, one array per `detect()` call. */
let frames: { rawValue: string }[][] = [];

class FakeDetector {
  static getSupportedFormats = async () => ["ean_13"];
  detect = async () => frames.shift() ?? [];
}

const decoded = vi.fn();

function Harness({ active }: { active: boolean }) {
  const scanner = useCameraScanner({ active, onDecode: decoded });
  // biome-ignore lint/a11y/useMediaCaption: a live camera preview has no audio and no captions to give
  return <video ref={scanner.videoRef} data-testid="preview" />;
}

beforeEach(() => {
  stopTrack.mockClear();
  decoded.mockClear();
  frames = [];

  /*
   * happy-dom's `srcObject` setter validates that it is given a real
   * `MediaStream` and throws otherwise, which has nothing to do with what
   * these tests are about — a stand-in stream is the only kind available
   * without a camera. Replaced with a plain accessor so the assignment
   * behaves the way a browser's does.
   *
   * Worth knowing that the throw is what surfaced a real defect: `start()` is
   * fire-and-forget, so it was swallowed as an unhandled rejection and left
   * the scanner on "Starting the camera…" for ever. The hook now catches it,
   * releases the camera and reports `failed`.
   */
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    writable: true,
    value: null,
  });

  vi.stubGlobal("BarcodeDetector", FakeDetector);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useCameraScanner", () => {
  it("hands a decoded barcode to onDecode", async () => {
    frames = [[{ rawValue: "5449000000996" }]];
    render(<Harness active />);

    await waitFor(() => expect(decoded).toHaveBeenCalledWith("5449000000996"));
  });

  it("reports one barcode once, however many frames see it", async () => {
    // A detector reports the same symbol on EVERY frame it can see it — five
    // or six times a second for as long as the packet is held up. Only the
    // first is a scan. Without the guard, one tin held for two seconds is
    // eleven lines on the receipt.
    frames = [
      [{ rawValue: "5449000000996" }],
      [{ rawValue: "5449000000996" }],
      [{ rawValue: "5449000000996" }],
      [{ rawValue: "5449000000996" }],
    ];
    render(<Harness active />);

    await waitFor(() => expect(decoded).toHaveBeenCalled());
    // Let several more frames go by.
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(decoded).toHaveBeenCalledTimes(1);
  });

  it("passes a DIFFERENT barcode straight through", async () => {
    // The guard is per value, not a blanket cooldown: two different items
    // presented back to back are two scans.
    frames = [[{ rawValue: "111" }], [{ rawValue: "222" }]];
    render(<Harness active />);

    await waitFor(() => expect(decoded).toHaveBeenCalledTimes(2));
    expect(decoded.mock.calls.map((call) => call[0])).toEqual(["111", "222"]);
  });

  it("stops every track when the scanner closes", async () => {
    // Clearing `srcObject` does NOT turn the camera off; only stopping the
    // tracks does. A light left on reads — reasonably — as being recorded.
    const { rerender } = render(<Harness active />);
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled(),
    );

    rerender(<Harness active={false} />);
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("stops every track on unmount", async () => {
    const { unmount } = render(<Harness active />);
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled(),
    );

    unmount();
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("stops the stream that arrives after its own effect was torn down", async () => {
    // The orphan. React 19 Strict Mode double-invokes effects in development,
    // so the first pass's cleanup runs while its `getUserMedia` is still
    // pending; the stream that promise resolves with belongs to nobody and,
    // unstopped, leaves the lens live with no component able to release it.
    // The same race happens in production whenever the sheet is closed before
    // the permission prompt is answered.
    let resolveStream: (stream: MediaStream) => void = () => {};
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveStream = resolve;
            }),
        ),
      },
    });

    const { unmount } = render(<Harness active />);
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled(),
    );

    // Close before the permission prompt is answered, THEN let it resolve.
    unmount();
    await act(async () => {
      resolveStream(fakeStream());
    });

    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("does not touch the camera at all while inactive", () => {
    render(<Harness active={false} />);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports a refused permission rather than throwing", async () => {
    const denial = Object.assign(new Error("nope"), {
      name: "NotAllowedError",
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(denial)) },
    });

    render(<Harness active />);

    // Nothing decoded, nothing thrown, and no unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(decoded).not.toHaveBeenCalled();
  });
});
