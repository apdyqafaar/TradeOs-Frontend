/**
 * The platform half of camera scanning: what this browser can do, what we ask
 * of the camera, and how to hand it back.
 *
 * No React and no markup — this file is a transcription of two web APIs and
 * nothing else, so the support matrix can be tested without mounting anything.
 * `features/sales/hooks/use-camera-scanner.ts` owns the lifecycle;
 * `components/counter/camera-scanner.tsx` owns the words.
 */

/**
 * The formats a shop's shelves actually carry.
 *
 * `new BarcodeDetector()` with no options asks for **every** format the
 * platform knows — on Chrome for Android that is thirteen, QR, Data Matrix,
 * PDF417, Aztec, ITF and Codabar among them. Two reasons not to take the
 * default:
 *
 *   - Each extra format is another decode attempt on every frame, on the cheap
 *     Android hardware this runs on. A camera scan is either faster than
 *     typing the digits or it is pointless.
 *   - A wider format set is a wider set of things to *mis*-read. Packaging
 *     carries QR codes for payments and promotions, often centimetres from the
 *     EAN. Decoding one hands the counter a URL to look up as a product name,
 *     which matches nothing and reads to the cashier as a broken scan.
 *
 * What is left is retail. **EAN-13** is the international article number on
 * almost everything sold in a shop; **EAN-8** is its short form for packages
 * too small for thirteen digits; **UPC-A** and **UPC-E** are the North
 * American equivalents, which arrive here on imported goods; **Code 128** and
 * **Code 39** are what a shop's own label printer emits for the items it
 * prices itself (loose grain, a re-packed carton) and are the only two of the
 * six a shopkeeper can generate without buying a GS1 prefix.
 *
 * Deliberately absent: QR and Data Matrix (not product identifiers here),
 * ITF-14 (a *carton* code — scanning the outer box would ring up one unit for
 * a case of twelve) and Codabar (libraries and blood banks, not shops).
 *
 * The strings are the spec's `BarcodeFormat` enum values, lower-snake-case.
 */
export const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
] as const;

/** What we ask `getUserMedia` for, and why each part is phrased this way. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    // `ideal`, never `exact`. `{ exact: "environment" }` is an
    // `OverconstrainedError` on every laptop and on a phone whose rear camera
    // is already held by another app — a refusal, where `ideal` quietly hands
    // back the front camera and lets the cashier decide whether it is usable.
    facingMode: { ideal: "environment" },
    // A barcode is thin vertical lines; below about 720p the bars of an EAN-13
    // on a small package land between sensor pixels and nothing ever decodes.
    // Still `ideal`, so a webcam that cannot do it is downgraded, not refused.
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  // Asking for audio would put a microphone in the permission prompt of a
  // feature that reads pictures of lines. Shopkeepers decline that, correctly.
  audio: false,
};

/** One decoded symbol, as `BarcodeDetector.detect()` answers. */
export interface DetectedBarcode {
  rawValue: string;
  format: string;
}

/**
 * The slice of `BarcodeDetector` this code uses.
 *
 * Declared here rather than imported: as of TypeScript 5.x `lib.dom.d.ts` has
 * no `BarcodeDetector`, because the Shape Detection API is not on a standards
 * track any implementer has finished.
 *
 * It is also the seam the **ZXing fallback** plugs into. Writing the shape out
 * rather than importing it is what lets a library decoder and the browser's own
 * look identical to everything above them: the frame loop, the repeat guard and
 * the stream lifecycle are written once and neither knows which one it has.
 */
export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

function detectorConstructor(): BarcodeDetectorConstructor | null {
  const ctor = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof ctor === "function"
    ? (ctor as BarcodeDetectorConstructor)
    : null;
}

/**
 * The **browser's own** detector for `BARCODE_FORMATS`, or `null` if it has
 * none — which is most browsers. Prefer `loadDetector()`, which falls back.
 *
 * The constructor is allowed to throw: the spec says a `TypeError` for an
 * empty or unknown format list, and an implementation that supports the API
 * but not one of the six would reject the whole list rather than narrow it.
 * A `null` here means "use the fallback", not "this browser cannot scan".
 */
export function createBarcodeDetector(): BarcodeDetectorLike | null {
  const Detector = detectorConstructor();
  if (!Detector) return null;

  try {
    return new Detector({ formats: BARCODE_FORMATS });
  } catch {
    return null;
  }
}

/**
 * A canvas to draw video frames onto, reused for the life of one scanner.
 *
 * ZXing decodes pixels, not elements, so every frame has to be drawn somewhere
 * first. A canvas per frame would mean six throwaway canvases a second on a
 * phone that is already running a camera.
 *
 * `willReadFrequently` is the one option that matters here: without it Chrome
 * keeps the canvas on the GPU and every `getImageData` is a synchronous
 * read-back across the bus.
 */
function frameCanvas(): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return context ? { canvas, context } : null;
}

/**
 * The ZXing decoder, wrapped to look exactly like `BarcodeDetector`.
 *
 * **Loaded with a dynamic `import()`, deliberately.** `@zxing/library` is a
 * large dependency and the counter is the screen a shift starts on; nobody who
 * never opens the camera should pay to download it. This runs when the scanner
 * opens, not when the module is imported, so the bundler gives it its own
 * chunk.
 *
 * Formats are pinned to the ones a shop actually carries. Left unrestricted,
 * ZXing tries every symbology it knows on every frame — including PDF417 and
 * Data Matrix, which are not on a tin of tomatoes — and a mid-range phone
 * spends its whole frame budget failing to find them.
 *
 * Returns `null` rather than throwing when the import fails (an offline first
 * load, a blocked chunk), so the caller reports "the camera could not be
 * started" instead of dying inside the frame loop.
 */
export async function loadZxingDetector(): Promise<BarcodeDetectorLike | null> {
  let zxing: typeof import("@zxing/library");
  try {
    zxing = await import("@zxing/library");
  } catch {
    return null;
  }

  const {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    HybridBinarizer,
    MultiFormatReader,
    RGBLuminanceSource,
  } = zxing;

  const reader = new MultiFormatReader();
  reader.setHints(
    new Map<number, unknown>([
      [
        DecodeHintType.POSSIBLE_FORMATS,
        [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          // Exactly the six in `BARCODE_FORMATS` above, and for the reasons
          // given there. ITF in particular is left out on purpose: it is a
          // CARTON code, so reading the outer box would ring up one unit for
          // a case of twelve.
        ],
      ],
      // A shelf barcode is usually straight and lit. `TRY_HARDER` roughly
      // doubles the work per frame to catch the rotated and damaged ones, and
      // six ordinary frames a second beat three thorough ones at a counter.
      [DecodeHintType.TRY_HARDER, false],
    ]),
  );

  const surface = frameCanvas();
  if (!surface) return null;
  const { canvas, context } = surface;

  return {
    async detect(source: CanvasImageSource): Promise<DetectedBarcode[]> {
      const video = source as HTMLVideoElement;
      const width = video.videoWidth;
      const height = video.videoHeight;

      // The first frames of every stream have no dimensions yet. Drawing a
      // 0×0 frame throws inside `getImageData`, and the loop would swallow
      // that as "no barcode" for ever if the size never arrived.
      if (!width || !height) return [];

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      const { data } = context.getImageData(0, 0, width, height);

      // `RGBLuminanceSource` takes one luminance byte per pixel; `getImageData`
      // gives four. Packed here rather than handed over raw so the alpha
      // channel — always 255 from a video frame — is dropped instead of being
      // read as brightness.
      const luminance = new Uint8ClampedArray(width * height);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        // Rec. 601 luma, integer-only: this runs a million times per frame.
        luminance[p] =
          ((data[i] ?? 0) * 77 +
            (data[i + 1] ?? 0) * 150 +
            (data[i + 2] ?? 0) * 29) >>
          8;
      }

      try {
        const bitmap = new BinaryBitmap(
          new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)),
        );
        const result = reader.decode(bitmap);
        const text = result.getText();
        return text
          ? [{ rawValue: text, format: String(result.getBarcodeFormat()) }]
          : [];
      } catch {
        // `NotFoundException` on a frame with no barcode in it — which is most
        // frames, and is not an error.
        return [];
      } finally {
        reader.reset();
      }
    },
  };
}

/**
 * The best decoder this browser can give us.
 *
 * Native first: it is hardware-accelerated where it exists and costs no
 * download. ZXing when there is none — which is **every desktop Chrome, every
 * Firefox and every iPhone**.
 *
 * `BarcodeDetector` ships on Android and ChromeOS only, and assuming otherwise
 * is what previously hid the camera button on the very machine this shop
 * develops and serves from. Feature-detecting it was right; treating its
 * absence as "this browser cannot scan" was not.
 */
export async function loadDetector(): Promise<BarcodeDetectorLike | null> {
  return createBarcodeDetector() ?? (await loadZxingDetector());
}

export type CameraUnavailableReason =
  /** Served over plain HTTP from something that is not `localhost`. */
  | "insecure-context"
  /** No `getUserMedia` at all — an old browser, or a locked-down webview. */
  | "no-camera-api";

export type CameraSupport =
  | { available: true }
  | { available: false; reason: CameraUnavailableReason };

/**
 * Whether this browser can decode a barcode from its camera, and if not, why.
 *
 * **The order of these checks is the whole point.** `getUserMedia` is exposed
 * only in a secure context, and so is `BarcodeDetector`, so a phone pointed at
 * `http://192.168.1.5:3000` — the LAN address a shop's own machine serves on —
 * fails *every* check below. Reporting that as "your browser cannot do this"
 * would be a lie that sends the owner shopping for a different phone, when the
 * fix is an `https://` address or `localhost`. So the context is asked about
 * first, and only a browser that genuinely has no camera or no decoder is told
 * so.
 *
 * `window.isSecureContext` is compared against `false` rather than read as a
 * boolean: it is `undefined` in environments that do not implement it (happy-dom
 * is one), and treating "unknown" as "insecure" would print the wrong sentence
 * everywhere the property is merely missing.
 *
 * **A missing `BarcodeDetector` is no longer a reason to refuse.** It used to
 * be, and that was a real mistake: the API ships on Android and ChromeOS only,
 * so desktop Chrome — the machine a shop's own counter PC runs, and the one
 * this was developed on — was told it could not scan while its webcam sat
 * there working. Decoding is now the fallback's problem (`loadDetector`), and
 * the only questions left are the two this genuinely cannot answer for itself:
 * is there a camera API, and are we allowed to use it here.
 */
export function cameraSupport(): CameraSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    // Server render. Nothing is offered until the client has looked.
    return { available: false, reason: "no-camera-api" };
  }

  const hasCamera = typeof navigator.mediaDevices?.getUserMedia === "function";

  if (!hasCamera && window.isSecureContext === false) {
    return { available: false, reason: "insecure-context" };
  }
  if (!hasCamera) return { available: false, reason: "no-camera-api" };

  return { available: true };
}

/**
 * Stops every track on a stream, which is the only thing that turns the
 * camera light off.
 *
 * Clearing `video.srcObject` does not: the track stays live and the indicator
 * stays on, which a shopkeeper reads — reasonably — as being recorded. Called
 * on close, on unmount, when the tab is hidden, and on the stream that arrives
 * after its own effect has already been cleaned up.
 */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * `torch` is a real capability on Android's rear camera and absent everywhere
 * else. It is not in `lib.dom`'s `MediaTrackCapabilities` or
 * `MediaTrackConstraintSet`, so both crossings are narrowed by hand here
 * rather than with an `any` at each call site.
 */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };

/** The video track whose torch can be driven, or `null` if none can. */
export function torchTrack(
  stream: MediaStream | null | undefined,
): MediaStreamTrack | null {
  if (!stream) return null;

  for (const track of stream.getVideoTracks()) {
    // `getCapabilities` is itself missing on Firefox and on older WebViews.
    if (typeof track.getCapabilities !== "function") continue;
    const capabilities = track.getCapabilities() as TorchCapabilities;
    if (capabilities.torch === true) return track;
  }

  return null;
}

/**
 * Turns the torch on or off. Resolves to whether it is now on.
 *
 * A rejection is an answer, not a crash: some devices advertise `torch` and
 * then refuse `applyConstraints` while the camera is warming up. The caller
 * gets `false` and the button un-presses, which is what the shopkeeper can
 * see anyway.
 */
export async function setTorch(
  track: MediaStreamTrack | null,
  on: boolean,
): Promise<boolean> {
  if (!track) return false;

  try {
    await track.applyConstraints({
      advanced: [{ torch: on } as TorchConstraint],
    });
    return on;
  } catch {
    return false;
  }
}
