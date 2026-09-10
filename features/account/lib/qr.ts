/**
 * A minimal QR encoder — byte mode, error-correction level M, versions 1-10.
 *
 * ## Why this file exists instead of a dependency
 *
 * `POST /auth/2fa/setup` returns `{ otpauthUri, secret }` and **no QR image**.
 * That is deliberate on the API's side (`Backend/src/lib/totp.ts:34-45`): the
 * URI is handed over so the client renders the code itself, which also means
 * the secret never travels as a bitmap through anything that caches images.
 * Something has to turn the URI into modules, and `package.json` carries no QR
 * library — adding one to this repo is the owner's call, not an implementation
 * detail of a settings screen (see `docs/findings/no-churn-on-working-deps.md`
 * for why dependency changes here need evidence and consent).
 *
 * So it is written out. It is ~200 lines of a well-specified algorithm with a
 * round-trip test beside it, and it keeps a credential-bearing string inside
 * code this repo owns.
 *
 * ## Scope, and why the limits are where they are
 *
 * **Byte mode only.** An `otpauth://` URI is mixed-case with punctuation;
 * alphanumeric mode cannot carry it and would only add a branch that never runs.
 *
 * **Level M** (~15% recovery). L is more capacious and Q/H are more robust; M
 * is the level authenticator apps are tuned for, and it fits every URI this
 * endpoint produces with room to spare.
 *
 * **Versions 1-10**, up to 213 bytes. The API's URI is
 * `otpauth://totp/TradeOs:<email>?secret=<32 base32 chars>&issuer=TradeOs`,
 * which is about 90 characters for a normal address and cannot approach 213
 * without an email longer than the API accepts. `encodeQr` throws rather than
 * silently truncating if it ever does — a truncated QR scans cleanly and
 * enrols the wrong secret, which is the one failure mode worth being loud
 * about.
 *
 * Nothing here logs, and the input string is never retained past the call.
 */

/** Level M, for every version below. */
const EC_LEVEL_BITS = 0b00;

interface VersionSpec {
  /** Total codewords, data + error correction. */
  totalCodewords: number;
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** `[blockCount, dataCodewordsPerBlock]` pairs — one or two groups. */
  groups: Array<[blocks: number, dataCodewords: number]>;
  /** Row/column centres of the alignment patterns. Empty for version 1. */
  alignment: number[];
}

/**
 * The level-M rows of ISO/IEC 18004 tables 9 and E.1, versions 1-10.
 *
 * Each row is self-checking and was checked: `sum(blocks * data) +
 * sum(blocks) * ecPerBlock` must equal `totalCodewords`. `qr.test.ts` asserts
 * exactly that for every row, so a mistyped number here fails a test rather
 * than producing a code that scans as garbage.
 */
const VERSIONS: Record<number, VersionSpec> = {
  1: { totalCodewords: 26, ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  2: {
    totalCodewords: 44,
    ecPerBlock: 16,
    groups: [[1, 28]],
    alignment: [6, 18],
  },
  3: {
    totalCodewords: 70,
    ecPerBlock: 26,
    groups: [[1, 44]],
    alignment: [6, 22],
  },
  4: {
    totalCodewords: 100,
    ecPerBlock: 18,
    groups: [[2, 32]],
    alignment: [6, 26],
  },
  5: {
    totalCodewords: 134,
    ecPerBlock: 24,
    groups: [[2, 43]],
    alignment: [6, 30],
  },
  6: {
    totalCodewords: 172,
    ecPerBlock: 16,
    groups: [[4, 27]],
    alignment: [6, 34],
  },
  7: {
    totalCodewords: 196,
    ecPerBlock: 18,
    groups: [[4, 31]],
    alignment: [6, 22, 38],
  },
  8: {
    totalCodewords: 242,
    ecPerBlock: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
    alignment: [6, 24, 42],
  },
  9: {
    totalCodewords: 292,
    ecPerBlock: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
    alignment: [6, 26, 46],
  },
  10: {
    totalCodewords: 346,
    ecPerBlock: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
    alignment: [6, 28, 50],
  },
};

const MAX_VERSION = 10;

/** Total data codewords for a version, from its block layout. */
export const dataCodewordsFor = (version: number): number => {
  const spec = VERSIONS[version];
  if (!spec) throw new Error(`Unsupported QR version ${version}`);
  return spec.groups.reduce((sum, [blocks, data]) => sum + blocks * data, 0);
};

/**
 * Bits the byte-mode character count takes: 8 up to version 9, 16 from version
 * 10. Getting this wrong shifts the entire payload by a byte and the code
 * scans as noise, so it is the one constant worth stating on its own line.
 */
const countBits = (version: number): number => (version >= 10 ? 16 : 8);

/** Byte capacity, allowing for the 4-bit mode indicator and the count field. */
export const capacityFor = (version: number): number =>
  Math.floor((dataCodewordsFor(version) * 8 - 4 - countBits(version)) / 8);

// ── GF(256) ────────────────────────────────────────────────────────────────
// Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), generator α = 2.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  // Doubled so a product of two logs (max 508) indexes without a modulo.
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** The generator polynomial for `degree` error-correction codewords. */
const generatorPoly = (degree: number): Uint8Array => {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
};

/** Reed-Solomon remainder — the error-correction codewords for one block. */
const ecCodewords = (data: Uint8Array, count: number): Uint8Array => {
  const generator = generatorPoly(count);
  const remainder = new Uint8Array(count);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[count - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < count; i += 1) {
        remainder[i] ^= gfMul(generator[i + 1], factor);
      }
    }
  }
  return remainder;
};

// ── BCH, for the format and version information ────────────────────────────

const bitLength = (value: number): number => {
  let length = 0;
  let rest = value;
  while (rest !== 0) {
    length += 1;
    rest >>>= 1;
  }
  return length;
};

const bchRemainder = (value: number, generator: number): number => {
  const width = bitLength(generator);
  let rest = value;
  while (bitLength(rest) >= width) {
    rest ^= generator << (bitLength(rest) - width);
  }
  return rest;
};

/**
 * 15 bits: 5 data bits (EC level then mask), 10 BCH bits, all XOR'd with
 * 0x5412 so an all-zero format never reads as valid.
 */
const formatInfo = (mask: number): number => {
  const data = (EC_LEVEL_BITS << 3) | mask;
  return (((data << 10) | bchRemainder(data << 10, 0x537)) ^ 0x5412) & 0x7fff;
};

/** 18 bits: 6 version bits and a 12-bit BCH remainder. Version 7 and up only. */
const versionInfo = (version: number): number =>
  ((version << 12) | bchRemainder(version << 12, 0x1f25)) & 0x3ffff;

// ── Matrix ─────────────────────────────────────────────────────────────────

/** `true` is a dark module. `reserved` marks everything data must not overwrite. */
interface Canvas {
  size: number;
  modules: boolean[][];
  reserved: boolean[][];
}

const createCanvas = (version: number): Canvas => {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
    reserved: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
  };
};

const place = (canvas: Canvas, row: number, col: number, dark: boolean) => {
  canvas.modules[row][col] = dark;
  canvas.reserved[row][col] = true;
};

/** A finder pattern and the one-module separator around it. */
const drawFinder = (canvas: Canvas, row: number, col: number) => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= canvas.size || x < 0 || x >= canvas.size) continue;
      const onRing = r === 0 || r === 6 || c === 0 || c === 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      place(canvas, y, x, inside && (onRing || inCore));
    }
  }
};

const drawAlignment = (canvas: Canvas, centres: number[]) => {
  for (const row of centres) {
    for (const col of centres) {
      // The three corners already hold finder patterns.
      if (canvas.reserved[row][col]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.max(Math.abs(r), Math.abs(c));
          place(canvas, row + r, col + c, edge !== 1);
        }
      }
    }
  }
};

const drawTiming = (canvas: Canvas) => {
  for (let i = 8; i < canvas.size - 8; i += 1) {
    const dark = i % 2 === 0;
    place(canvas, 6, i, dark);
    place(canvas, i, 6, dark);
  }
};

/** Reserve the format areas, and the version areas from version 7. */
const reserveInfoAreas = (canvas: Canvas, version: number) => {
  const { size } = canvas;
  for (let i = 0; i < 9; i += 1) {
    if (!canvas.reserved[8][i]) place(canvas, 8, i, false);
    if (!canvas.reserved[i][8]) place(canvas, i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!canvas.reserved[8][size - 1 - i])
      place(canvas, 8, size - 1 - i, false);
    if (!canvas.reserved[size - 1 - i][8])
      place(canvas, size - 1 - i, 8, false);
  }
  // Always dark, always at this exact module (ISO 18004 §6.9.1).
  place(canvas, size - 8, 8, true);

  if (version < 7) return;
  for (let i = 0; i < 18; i += 1) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    place(canvas, row, size - 11 + col, false);
    place(canvas, size - 11 + col, row, false);
  }
};

/**
 * The fifteen format bits, twice: once around the top-left finder, once split
 * between the other two.
 *
 * Both copies are written from the same `bits`, and the two layouts are not
 * mirror images of each other — the first copy runs down column 8 and then
 * left along row 8 with a one-module jog at the timing pattern, while the
 * second runs up column 8 from the bottom and right along row 8. Writing one
 * copy with the other's row/column order produces a symbol that looks
 * plausible and cannot be read; `qr.test.ts` reads the bits back out of a
 * finished matrix to prove it does not happen here.
 */
const writeFormatInfo = (canvas: Canvas, mask: number) => {
  const bits = formatInfo(mask);
  const { size } = canvas;
  const bitAt = (index: number) => ((bits >> index) & 1) === 1;

  // Copy one: down column 8, then left along row 8.
  for (let i = 0; i < 6; i += 1) canvas.modules[i][8] = bitAt(i);
  canvas.modules[7][8] = bitAt(6);
  canvas.modules[8][8] = bitAt(7);
  canvas.modules[8][7] = bitAt(8);
  for (let i = 9; i < 15; i += 1) canvas.modules[8][14 - i] = bitAt(i);

  // Copy two: right along row 8 from the far edge, then up column 8.
  for (let i = 0; i < 8; i += 1) canvas.modules[8][size - 1 - i] = bitAt(i);
  for (let i = 8; i < 15; i += 1) canvas.modules[size - 15 + i][8] = bitAt(i);
};

/** The inverse of the copy-one layout above, for `decodeQr`. */
const readFormatInfo = (modules: boolean[][]): number => {
  const bit = (row: number, col: number, index: number) =>
    modules[row][col] ? 1 << index : 0;

  let bits = 0;
  for (let i = 0; i < 6; i += 1) bits |= bit(i, 8, i);
  bits |= bit(7, 8, 6);
  bits |= bit(8, 8, 7);
  bits |= bit(8, 7, 8);
  for (let i = 9; i < 15; i += 1) bits |= bit(8, 14 - i, i);
  return bits;
};

const writeVersionInfo = (canvas: Canvas, version: number) => {
  if (version < 7) return;
  const bits = versionInfo(version);
  const { size } = canvas;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    canvas.modules[row][size - 11 + col] = bit;
    canvas.modules[size - 11 + col][row] = bit;
  }
};

const MASKS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Every module that is not data: the three finders and their separators, the
 * alignment patterns, both timing lines, the reserved format and version
 * areas, and the always-dark module.
 *
 * One function so `encodeQr` and `decodeQr` can never disagree about which
 * modules carry data — a decoder that reserved one module differently from the
 * encoder would read the whole payload off by a bit and blame the data.
 */
function drawFunctionPatterns(version: number): Canvas {
  const spec = VERSIONS[version];
  if (!spec) throw new Error(`Unsupported QR version ${version}`);

  const canvas = createCanvas(version);
  drawFinder(canvas, 0, 0);
  drawFinder(canvas, 0, canvas.size - 7);
  drawFinder(canvas, canvas.size - 7, 0);
  drawAlignment(canvas, spec.alignment);
  drawTiming(canvas);
  reserveInfoAreas(canvas, version);
  return canvas;
}

/**
 * Walk the data region: two columns at a time, right to left, alternating
 * upward and downward, skipping column 6 (the vertical timing pattern).
 */
function dataModulePositions(canvas: Canvas): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  const { size } = canvas;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    const rightCol = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [rightCol, rightCol - 1]) {
        if (canvas.reserved[row][col]) continue;
        positions.push([row, col]);
      }
    }
    upward = !upward;
  }
  return positions;
}

/** ISO 18004 §6.8.3.1 — the four penalty rules, summed. */
const penalty = (modules: boolean[][]): number => {
  const size = modules.length;
  let score = 0;

  // Rule 1: runs of five or more of the same colour, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const read of [
      (k: number) => modules[i][k],
      (k: number) => modules[k][i],
    ]) {
      let run = 1;
      for (let k = 1; k < size; k += 1) {
        if (read(k) === read(k - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const first = modules[r][c];
      if (
        modules[r][c + 1] === first &&
        modules[r + 1][c] === first &&
        modules[r + 1][c + 1] === first
      ) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules beside
  // it, which is what a scanner mistakes for a finder pattern.
  const pattern = [true, false, true, true, true, false, true];
  const light = [false, false, false, false];
  const matches = (read: (k: number) => boolean, at: number, seq: boolean[]) =>
    seq.every((want, offset) => read(at + offset) === want);

  for (let i = 0; i < size; i += 1) {
    for (const read of [
      (k: number) => modules[i][k],
      (k: number) => modules[k][i],
    ]) {
      for (let k = 0; k + 7 <= size; k += 1) {
        if (!matches(read, k, pattern)) continue;
        const before = k >= 4 && matches(read, k - 4, light);
        const after = k + 11 <= size && matches(read, k + 7, light);
        if (before || after) score += 40;
      }
    }
  }

  // Rule 4: deviation from an even split of dark and light.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
};

// ── Encoding ───────────────────────────────────────────────────────────────

const toCodewords = (bytes: Uint8Array, version: number): Uint8Array => {
  const capacity = dataCodewordsFor(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // Byte mode.
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  // Terminator: up to four zero bits, then pad to a byte boundary.
  const room = capacity * 8 - bits.length;
  push(0, Math.min(4, room));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    codewords[i / 8] = byte;
  }

  // The two pad codewords, alternating, for the rest of the capacity.
  const PADS = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < capacity; i += 1, p += 1) {
    codewords[i] = PADS[p % 2];
  }
  return codewords;
};

/**
 * Split into blocks, compute each block's EC, then interleave: data codeword
 * `k` of every block in turn, then EC codeword `k` of every block in turn.
 * Blocks are uneven in versions 8-10, so the data pass has to skip the short
 * blocks once it runs past their length.
 */
const interleave = (codewords: Uint8Array, version: number): Uint8Array => {
  const spec = VERSIONS[version];
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (const [blocks, size] of spec.groups) {
    for (let i = 0; i < blocks; i += 1) {
      const block = codewords.subarray(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, spec.ecPerBlock));
    }
  }

  const out: number[] = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return Uint8Array.from(out);
};

/** The smallest version 1-10 that holds `byteLength`, or `null` if none does. */
export const versionFor = (byteLength: number): number | null => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteLength <= capacityFor(version)) return version;
  }
  return null;
};

export interface QrMatrix {
  /** `size × size` booleans; `true` is dark. Excludes the quiet zone. */
  modules: boolean[][];
  size: number;
  version: number;
}

/**
 * Encode `text` as a QR matrix.
 *
 * Throws for an empty string and for anything longer than version 10 holds. A
 * throw is deliberate: this renders a **credential**, and a silently truncated
 * QR still scans — it just enrols a secret that will never produce a code the
 * server accepts, which surfaces as "my authenticator is broken" days later.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) throw new Error("Nothing to encode");

  const version = versionFor(bytes.length);
  if (version === null) {
    throw new Error(
      `${bytes.length} bytes is more than this encoder holds (max ${capacityFor(MAX_VERSION)})`,
    );
  }

  const payload = interleave(toCodewords(bytes, version), version);

  const canvas = drawFunctionPatterns(version);
  const positions = dataModulePositions(canvas);
  positions.forEach(([row, col], index) => {
    const byte = payload[index >> 3];
    // Past the payload are the version's remainder bits, which are zero.
    const bit = byte === undefined ? 0 : (byte >> (7 - (index & 7))) & 1;
    canvas.modules[row][col] = bit === 1;
  });

  // Try all eight masks and keep the least penalised, which is what the spec
  // asks for and what keeps a code readable at an angle.
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = canvas.modules.map((row) => [...row]);
    for (const [row, col] of positions) {
      if (MASKS[mask](row, col)) candidate[row][col] = !candidate[row][col];
    }
    const masked: Canvas = { ...canvas, modules: candidate };
    writeFormatInfo(masked, mask);
    writeVersionInfo(masked, version);

    const score = penalty(candidate);
    if (!best || score < best.score) best = { mask, modules: candidate, score };
  }

  if (!best) throw new Error("No mask produced a matrix");
  return { modules: best.modules, size: canvas.size, version };
}

/**
 * Read a matrix this module produced back into the string it encodes.
 *
 * **Not a scanner.** It assumes an undamaged matrix and ignores the
 * error-correction codewords entirely — it recovers the mask from the format
 * bits, un-masks the data region, de-interleaves the blocks and reads the byte
 * mode header. A real decoder would run Reed-Solomon over each block first.
 *
 * It exists so `qr.test.ts` can prove the encoder round-trips: placement,
 * masking, the format-bit layout and the block interleave are each a
 * transcription of a table, and a transcription error in any one of them
 * produces a matrix that looks like a QR code, renders convincingly, and does
 * not scan. Round-tripping is the cheapest way to catch that without a camera.
 */
export function decodeQr(matrix: QrMatrix): string {
  const { version, modules } = matrix;
  const spec = VERSIONS[version];
  if (!spec) throw new Error(`Unsupported QR version ${version}`);

  // The 15-bit word is `data << 10 | bch`, XOR'd with 0x5412. `data` is five
  // bits — two of EC level, then three of mask — so the mask is bits 12..10 of
  // the un-XOR'd word, not its low three bits, which are BCH remainder.
  const mask = ((readFormatInfo(modules) ^ 0x5412) >> 10) & 0b111;
  const canvas = drawFunctionPatterns(version);
  const positions = dataModulePositions(canvas);

  // Un-mask straight into a bit array; the function patterns are never masked.
  const bits: number[] = positions.map(([row, col]) => {
    const dark = modules[row][col];
    return (MASKS[mask](row, col) ? !dark : dark) ? 1 : 0;
  });

  const interleaved = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < interleaved.length; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i * 8 + b];
    interleaved[i] = byte;
  }

  // De-interleave: the reverse of `interleave`, data pass only.
  const sizes: number[] = [];
  for (const [blocks, size] of spec.groups) {
    for (let i = 0; i < blocks; i += 1) sizes.push(size);
  }
  const blocks = sizes.map((size) => new Uint8Array(size));
  const longest = Math.max(...sizes);
  let cursor = 0;
  for (let i = 0; i < longest; i += 1) {
    for (let b = 0; b < blocks.length; b += 1) {
      if (i < sizes[b]) blocks[b][i] = interleaved[cursor++];
    }
  }

  const data = new Uint8Array(dataCodewordsFor(version));
  let at = 0;
  for (const block of blocks) {
    data.set(block, at);
    at += block.length;
  }

  const readBits = (offset: number, length: number): number => {
    let value = 0;
    for (let i = 0; i < length; i += 1) {
      const index = offset + i;
      value = (value << 1) | ((data[index >> 3] >> (7 - (index & 7))) & 1);
    }
    return value;
  };

  if (readBits(0, 4) !== 0b0100) throw new Error("Not a byte-mode QR");
  const length = readBits(4, countBits(version));
  const start = 4 + countBits(version);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = readBits(start + i * 8, 8);
  return new TextDecoder().decode(bytes);
}
