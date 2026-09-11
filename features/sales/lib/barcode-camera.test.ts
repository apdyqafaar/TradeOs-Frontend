import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BARCODE_FORMATS,
  cameraSupport,
  createBarcodeDetector,
  loadDetector,
  loadZxingDetector,
} from "./barcode-camera";

/**
 * These tests exist because of a bug that shipped clean.
 *
 * Camera scanning was written against `BarcodeDetector` alone, and
 * `cameraSupport()` reported "this browser cannot scan" when it was missing.
 * Every test passed, because happy-dom has no `BarcodeDetector` either and the
 * suite only ever asserted the refusal. What it actually did was hide the
 * camera button on **desktop Chrome, Firefox and every iPhone** — the API ships
 * on Android and ChromeOS only — including the Windows machine the shop runs
 * its counter on. The webcam sat there working and the button was not drawn.
 *
 * So the two things worth protecting are: the support check must not ask about
 * a decoder, and the ZXing fallback must genuinely decode.
 *
 * **The decode tests are real round trips.** A barcode is encoded to modules
 * here, handed over as camera pixels, and the assertion is that the digits come
 * back out. What they cannot cover is `drawImage` — there is no compositor in
 * happy-dom — so the fake context returns the frame the real one would have
 * produced. Everything after that point is this file's own code: the RGBA→luma
 * packing, the `BinaryBitmap` construction and the mapping to `DetectedBarcode`.
 *
 * The barcodes are generated rather than pasted as fixtures because a fixture
 * of 119 booleans is unreviewable — nobody can tell a correct one from a
 * corrupted one by looking. Generated, a mistake in the tables cannot produce a
 * false pass: a wrong pattern simply does not decode.
 *
 * **What these do not pin, and deliberately:** the exact Rec. 601 coefficients
 * in the packing loop. Break-testing found that zeroing the green weight, or
 * shifting by 4 instead of 8, still passes — on black bars against white paper
 * any transform that keeps dark below light decodes identically, so the
 * constants have no observable effect on a barcode. What the same break-test
 * showed IS covered is the packing's shape: stepping the source by 3 instead of
 * 4 reddens every decode test, because that is the error that actually garbles
 * a frame.
 */

/** The Coca-Cola EAN-13. A real, checksum-valid code, as a shelf would carry. */
const EAN_13 = "5449000000996";

/**
 * Big enough that a narrow bar is several pixels wide.
 *
 * At one or two pixels per module the binarizer has nothing to threshold and
 * the failures are about the fixture rather than about the code under test.
 */
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 160;

/* ------------------------------------------------------------------ *
 * EAN-13, per the spec's three alphabets.
 *
 * 95 modules: guard `101`, six left digits of seven, centre guard `01010`,
 * six right digits of seven, guard `101`. The THIRTEENTH digit is never drawn —
 * it is carried by which of the L and G alphabets each left digit uses, which
 * is why a 13-digit code fits in twelve digits' worth of bars.
 * ------------------------------------------------------------------ */

/** Odd parity. */
const EAN_L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
/** Even parity — each entry is its `EAN_R` row reversed. */
const EAN_G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
/** The right half — each entry is its `EAN_L` row complemented. */
const EAN_R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
/** Which alphabet each of the six left digits uses, chosen by the first digit. */
const EAN_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

function encodeEan13(value: string): boolean[] {
  const digits = [...value].map(Number);
  const parity = EAN_PARITY[digits[0] as number] as string;

  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const digit = digits[i + 1] as number;
    bits += parity[i] === "L" ? EAN_L[digit] : EAN_G[digit];
  }
  bits += "01010";
  for (let i = 7; i < 13; i++) {
    bits += EAN_R[digits[i] as number];
  }
  bits += "101";

  return [...bits].map((bit) => bit === "1");
}

/* ------------------------------------------------------------------ *
 * Code 39 — what a shop's own label printer emits.
 *
 * Each character is nine elements, alternating bar and space, of which exactly
 * three are wide. The table below is **ZXing's own** `CHARACTER_ENCODINGS`,
 * lifted from `Code39Reader`: taking it from the decoder that has to read this
 * back is what keeps the fixture honest — an encoder written from a different
 * source could disagree with the reader and the test would be about the
 * disagreement rather than about the wrapper.
 * ------------------------------------------------------------------ */

const CODE_39_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
const CODE_39_ENCODINGS = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, 0x109,
  0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c, 0x103, 0x043,
  0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016, 0x181, 0x0c1, 0x1c0,
  0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4, 0x0a8, 0x0a2, 0x08a, 0x02a,
];
/** The `*` that opens and closes every Code 39 symbol. */
const CODE_39_ASTERISK = 0x094;

function encodeCode39(value: string): boolean[] {
  const modules: boolean[] = [];

  const pushCharacter = (encoding: number) => {
    for (let element = 0; element < 9; element++) {
      // Bit 8 is the first element; a set bit is a WIDE element (two modules).
      const wide = ((encoding >> (8 - element)) & 1) === 1;
      // Even elements are bars, odd are spaces.
      const black = element % 2 === 0;
      for (let n = 0; n < (wide ? 2 : 1); n++) modules.push(black);
    }
    // The narrow space between characters, which is part of the symbol.
    modules.push(false);
  };

  pushCharacter(CODE_39_ASTERISK);
  for (const character of value) {
    pushCharacter(
      CODE_39_ENCODINGS[CODE_39_ALPHABET.indexOf(character)] as number,
    );
  }
  pushCharacter(CODE_39_ASTERISK);

  return modules;
}

/**
 * Modules to the RGBA bytes a camera frame arrives as.
 *
 * The quiet zone is not decoration: every 1D reader needs clear space either
 * side to find the start guard, and a barcode drawn flush to the edge of the
 * frame does not decode in a browser either.
 */
function renderFrame(modules: boolean[]): Uint8ClampedArray {
  const QUIET = 12;
  const total = modules.length + QUIET * 2;
  const scale = Math.floor(FRAME_WIDTH / total);
  const drawnWidth = total * scale;
  const left = Math.floor((FRAME_WIDTH - drawnWidth) / 2);

  const rgba = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
  rgba.fill(255);

  for (let m = 0; m < modules.length; m++) {
    if (!modules[m]) continue;
    const startX = left + (QUIET + m) * scale;
    for (let x = startX; x < startX + scale; x++) {
      for (let y = 0; y < FRAME_HEIGHT; y++) {
        const i = (y * FRAME_WIDTH + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
      }
    }
  }
  return rgba;
}

/** An empty shelf: the frame the loop sees for all but a few frames a scan. */
function blankFrame(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
  rgba.fill(255);
  return rgba;
}

/** What the detector is handed. Only the two dimensions are ever read. */
function fakeVideo(width = FRAME_WIDTH, height = FRAME_HEIGHT) {
  return { videoWidth: width, videoHeight: height } as CanvasImageSource;
}

/** The pixels the stubbed `getImageData` will hand back on the next call. */
let framePixels: Uint8ClampedArray = new Uint8ClampedArray(0);
const drawImage = vi.fn();

beforeEach(() => {
  // happy-dom implements no camera API, so `cameraSupport()` would refuse here
  // for a reason that has nothing to do with what is being tested. Supplied so
  // the only open question in that test is the detector. Re-installed every
  // time, which is what lets the no-camera test below simply delete it.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });

  // happy-dom has no 2D context at all, so there is nothing to spy on — it has
  // to be supplied. `getContext` returning null is also the branch where
  // `loadZxingDetector()` gives up, which one test below drives on purpose.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => ({
      drawImage,
      getImageData: () => ({
        data: framePixels,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      }),
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  drawImage.mockClear();
});

describe("cameraSupport", () => {
  it("offers the camera on a browser with no BarcodeDetector", () => {
    // THE REGRESSION. happy-dom has no `BarcodeDetector`, exactly like desktop
    // Chrome, and this must still come back available — the decoder is
    // `loadDetector()`'s problem now, not a reason to hide the button.
    expect("BarcodeDetector" in globalThis).toBe(false);

    expect(cameraSupport()).toEqual({ available: true });
  });

  it("refuses when there is no camera API at all", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    expect(cameraSupport()).toEqual({
      available: false,
      reason: "no-camera-api",
    });
  });
});

describe("loadZxingDetector", () => {
  it("decodes an EAN-13 off a camera frame", async () => {
    framePixels = renderFrame(encodeEan13(EAN_13));

    const detector = await loadZxingDetector();
    const found = await detector?.detect(fakeVideo());

    expect(found?.[0]?.rawValue).toBe(EAN_13);
  });

  it("decodes a Code 39 label a shop printed itself", async () => {
    // The other half of `BARCODE_FORMATS` that matters: loose grain and
    // re-packed cartons get a label from the shop's own printer, and a shop
    // cannot generate an EAN without buying a GS1 prefix. A build that only
    // decoded EAN would look right on branded stock and fail on everything
    // priced in the back room.
    framePixels = renderFrame(encodeCode39("TRADEOS42"));

    const detector = await loadZxingDetector();
    const found = await detector?.detect(fakeVideo());

    expect(found?.[0]?.rawValue).toBe("TRADEOS42");
  });

  it("returns nothing for a frame with no barcode in it", async () => {
    // Most frames. This must be an empty array and not a throw, or the frame
    // loop stops scanning the moment the lens points at the counter.
    framePixels = blankFrame();

    const detector = await loadZxingDetector();

    await expect(detector?.detect(fakeVideo())).resolves.toEqual([]);
  });

  it("does not read a frame that has no dimensions yet", async () => {
    // The first frames of every stream. `getImageData` on a 0×0 canvas throws
    // in a real browser, and the loop would swallow it as "no barcode" for
    // ever if the size never arrived.
    framePixels = renderFrame(encodeEan13(EAN_13));

    const detector = await loadZxingDetector();
    const found = await detector?.detect(fakeVideo(0, 0));

    expect(found).toEqual([]);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("gives up rather than throwing when there is no 2D context", async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: () => null,
    });

    await expect(loadZxingDetector()).resolves.toBeNull();
  });

  it("pins itself to the same formats as the native detector", () => {
    // Both decoders answer the same six, so a scan cannot succeed on one
    // browser and fail on another for a reason nobody can see.
    expect(BARCODE_FORMATS).toEqual([
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "code_128",
      "code_39",
    ]);
  });
});

describe("loadDetector", () => {
  it("prefers the browser's own detector when it has one", async () => {
    // Android and ChromeOS. Native is hardware-accelerated and costs no
    // download, so ZXing must not be loaded over the top of it.
    const detect = vi.fn(async () => []);
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        detect = detect;
      },
    );

    const detector = await loadDetector();
    await detector?.detect(fakeVideo());

    expect(detect).toHaveBeenCalled();
  });

  it("falls back to ZXing when the browser has none", async () => {
    framePixels = renderFrame(encodeEan13(EAN_13));

    const detector = await loadDetector();
    const found = await detector?.detect(fakeVideo());

    // Decoding at all is the proof: nothing native exists here to have done it.
    expect(createBarcodeDetector()).toBeNull();
    expect(found?.[0]?.rawValue).toBe(EAN_13);
  });
});
