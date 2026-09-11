"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type BarcodeDetectorLike,
  CAMERA_CONSTRAINTS,
  type CameraSupport,
  cameraSupport,
  loadDetector,
  setTorch,
  stopStream,
  torchTrack,
} from "@/features/sales/lib/barcode-camera";

/**
 * How often a frame is read.
 *
 * Self-scheduled after each `detect()` resolves rather than driven by an
 * interval, so two decodes can never overlap — `detect()` takes 20-80ms on a
 * mid-range Android and an interval shorter than that would queue work faster
 * than the phone retires it. `requestAnimationFrame` was the other candidate
 * and is worse here: it ties decoding to paint, which is 60 attempts a second
 * for a job that gains nothing past about six.
 */
const DETECT_INTERVAL_MS = 180;

/**
 * How long the same decoded value is ignored after it has been handed on.
 *
 * A detector reports the same symbol on **every frame it can see it** — five
 * or six times a second for as long as the packet is in front of the lens.
 * Only the first of those is a scan; the rest are the same barcode still being
 * there. Without this, one tin of tomatoes held up for two seconds is eleven
 * lines on the receipt.
 *
 * It is a window rather than a permanent block because scanning the same item
 * twice is how a cashier rings up two of them. Two seconds is longer than the
 * hand takes to leave the lens and shorter than it takes to present the next
 * item.
 */
const REPEAT_GUARD_MS = 2000;

export type CameraScannerStatus =
  /** `getUserMedia` is out, and the permission prompt may be on screen. */
  | "starting"
  /** Frames are being read. */
  | "scanning"
  /** The tab went to the background; the camera was released. */
  | "paused"
  /** The person said no, or the browser's policy did. */
  | "denied"
  /** No camera on this device, or none matching the constraints. */
  | "no-camera"
  /** Another app or tab holds the camera. */
  | "busy"
  /** Anything else, including a detector this browser would not construct. */
  | "failed";

export interface CameraTorch {
  available: boolean;
  on: boolean;
  toggle: () => void;
}

export interface CameraScanner {
  /** Attach to the `<video>`. The hook writes `srcObject` and never reads it. */
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraScannerStatus;
  torch: CameraTorch;
}

export interface UseCameraScannerOptions {
  /** True while the scanner is on screen. False releases the camera. */
  active: boolean;
  /** Called once per decoded barcode. See `REPEAT_GUARD_MS` for "once". */
  onDecode: (value: string) => void;
}

/**
 * Holds a camera open, reads barcodes off its frames, and — the part that
 * matters — always gives it back.
 *
 * **Every exit stops the tracks**: closing the scanner (`active` goes false),
 * unmounting, the tab going to the background, and the case that is easy to
 * miss — a stream that arrives *after* its own effect was cleaned up. React 19
 * Strict Mode double-invokes effects in development, so the first pass's
 * cleanup runs while the first pass's `getUserMedia` promise is still pending;
 * whatever that promise resolves with belongs to nobody and, unstopped, leaves
 * the camera light on with no component holding a reference to turn it off.
 * The same race happens in production whenever the sheet is closed before the
 * permission prompt is answered.
 *
 * Nothing here knows what a barcode means. A decoded value is handed to
 * `onDecode` exactly as a cashier's keystrokes would arrive, which is what
 * keeps the camera on the same lookup path as the laser scanner instead of
 * growing a second one.
 */
export function useCameraScanner({
  active,
  onDecode,
}: UseCameraScannerOptions): CameraScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraScannerStatus>("starting");
  const [torchReady, setTorchReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /**
   * Bumped to restart the camera after the tab comes back. A counter, not a
   * boolean, so a second background/foreground round trip restarts it again.
   */
  const [generation, setGeneration] = useState(0);

  /*
   * `onDecode` is a fresh function on every render — the React Compiler is on,
   * so there is no `useCallback` to stabilise it and adding one would fight
   * the compiler. Putting it in the effect's dependencies would therefore tear
   * the camera down and rebuild it on every keystroke behind the sheet. The
   * ref is written in its own effect (after commit, never during render) and
   * read only from inside the frame loop.
   */
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  });

  /*
   * `generation` below is a re-run TRIGGER, not a value this effect reads —
   * the one shape `useExhaustiveDependencies` cannot see, which is why it is
   * suppressed on the next line rather than obeyed.
   *
   * `onVisibility` bumps it when the tab returns to the foreground, and
   * re-running this effect IS the resume mechanism: teardown releases the old
   * (already-stopped) stream, and the new run gets its own `cancelled` flag.
   * Taking the suggested fix compiles, lints clean, and silently leaves the
   * camera dead the first time someone switches apps mid-shift.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastValue = "";
    let lastAt = 0;

    // Resolved once per run, not per frame: a decoder allocates state for
    // every format it is asked for, and the ZXing one is a dynamic import.
    // `let`, because it is awaited inside `start()` — the frame loop reads it
    // only after that await has resolved.
    let detector: BarcodeDetectorLike | null = null;

    const release = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      // Cosmetic, and only after the tracks are stopped: clearing `srcObject`
      // on its own leaves the camera live and the indicator lit.
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const handle = (value: string) => {
      const now = Date.now();
      if (value === lastValue && now - lastAt < REPEAT_GUARD_MS) return;
      lastValue = value;
      lastAt = now;
      onDecodeRef.current(value);
    };

    const start = async () => {
      /*
       * The decoder BEFORE the camera, deliberately.
       *
       * `loadDetector()` may be a dynamic `import()` of ZXing — a real
       * download on the first scan of a session. Asking for the camera first
       * would light the lens up and hold it while that lands, and if the
       * import then failed the shopkeeper would have granted a permission for
       * a feature that never worked.
       */
      detector = await loadDetector();
      if (cancelled) return;

      if (!detector) {
        // No native detector AND the fallback would not load — an offline
        // first scan, or a blocked chunk. Asking for the camera now would
        // light it up to read nothing.
        setStatus("failed");
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch (error) {
        if (!cancelled) setStatus(statusForFailure(error));
        return;
      }

      if (cancelled) {
        // The orphan described in this hook's docblock. Nothing references it
        // and nothing ever will, so it is stopped right here.
        stopStream(stream);
        return;
      }

      streamRef.current = stream;
      setTorchReady(torchTrack(stream) !== null);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        /*
         * Started, NOT awaited.
         *
         * `autoPlay` covers this wherever it is honoured; a muted inline video
         * needs the explicit call on some builds. But the returned promise is
         * not something to block on: it rejects under an autoplay policy, and
         * — the case that actually bit — it can simply never settle when the
         * element has nothing real to play. Awaiting it strands the scanner in
         * "Starting the camera…" for ever with the lens already live, and no
         * error anywhere to say why.
         *
         * Nothing downstream needs it to have resolved. `detect()` reads
         * frames off the element and already tolerates a frame with no pixels
         * yet, which is the first hundred milliseconds of every stream.
         */
        void video.play().catch(() => {
          // Autoplay policy, or an element detached since `srcObject` was set.
        });
      }

      // Cleanup may have run across either await above; `release` has already
      // stopped what `streamRef` was holding.
      if (cancelled) return;

      setStatus("scanning");
      void tick();
    };

    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || !video || !detector) return;

      try {
        const found = await detector.detect(video);
        const value = (found[0]?.rawValue ?? "").trim();
        if (value !== "") handle(value);
      } catch {
        // `detect()` rejects on a frame with no pixels yet — the first
        // hundred milliseconds of every stream — and intermittently after
        // that on some devices. Neither is a reason to stop scanning.
      }

      if (cancelled) return;
      timer = setTimeout(() => void tick(), DETECT_INTERVAL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // A phone that switches to WhatsApp mid-shift must not leave the lens
        // live. Some Android builds suspend the frames anyway, so the loop
        // would otherwise spin reading nothing with the light on.
        release();
        setStatus("paused");
        setTorchReady(false);
        setTorchOn(false);
        return;
      }
      // Back in the foreground with the scanner still open: re-run this effect
      // from the top, which gives the new run its own `cancelled`.
      setGeneration((n) => n + 1);
    };

    setStatus("starting");
    setTorchOn(false);
    document.addEventListener("visibilitychange", onVisibility);
    /*
     * The catch is not decoration. `start()` is fire-and-forget, so anything
     * it throws past the `getUserMedia` try/catch — a `srcObject` setter that
     * rejects the stream, a torch capability read that blows up on some
     * WebView — becomes an unhandled rejection and nothing else. The visible
     * result is the sheet sitting on "Starting the camera…" for ever with the
     * lens already live and no error anywhere saying why.
     *
     * `release()` first, because the failure may well be AFTER the stream was
     * handed over, and a stuck scanner that is also still recording is the
     * worse half of the bug.
     */
    void start().catch(() => {
      if (cancelled) return;
      release();
      setStatus("failed");
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active, generation]);

  const toggleTorch = () => {
    const track = torchTrack(streamRef.current);
    const next = !torchOn;
    void setTorch(track, next).then((now) => setTorchOn(now));
  };

  return {
    videoRef,
    status,
    torch: { available: torchReady, on: torchOn, toggle: toggleTorch },
  };
}

/**
 * `getUserMedia`'s refusals, told apart by `DOMException.name`.
 *
 * The names are the only stable thing about them — the messages differ between
 * browsers, change between versions and are written in English for a screen
 * that is not.
 */
function statusForFailure(error: unknown): CameraScannerStatus {
  const name = error instanceof Error ? error.name : "";

  switch (name) {
    // `SecurityError` is the same refusal arriving through a Permissions-Policy
    // header or an iframe without `allow="camera"`.
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    // `OverconstrainedError` here means no camera matched, and since every
    // constraint we send is `ideal`, that can only be "there is no camera".
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-camera";
    // The hardware exists and something else has it: another tab, another app,
    // or a driver that did not let go.
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    default:
      return "failed";
  }
}

/**
 * What this browser can do, resolved on the client only.
 *
 * `null` until the first effect runs. `cameraSupport()` reads `navigator` and
 * `window`, so calling it during render would answer for the server and then
 * disagree with the client — a hydration mismatch on the counter, which is the
 * one screen that must not flicker.
 */
export function useCameraSupport(): CameraSupport | null {
  const [support, setSupport] = useState<CameraSupport | null>(null);

  useEffect(() => {
    setSupport(cameraSupport());
  }, []);

  return support;
}
