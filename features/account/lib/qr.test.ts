import { describe, expect, it } from "vitest";
import {
  capacityFor,
  dataCodewordsFor,
  decodeQr,
  encodeQr,
  versionFor,
} from "./qr";

/**
 * This encoder exists because the API returns an `otpauth://` URI and no QR
 * image, and adding a QR dependency is the owner's call, not this slice's (see
 * the header of `qr.ts`). Everything in it is a transcription of a table or of
 * a placement rule, and every one of those transcriptions fails the same way:
 * the matrix still looks like a QR code, still renders, and does not scan — or
 * worse, scans into a *different* secret.
 *
 * So the tests are not about individual functions. The important one is the
 * round trip: encode, then read the matrix back with an independent walk of
 * the same geometry. That catches a wrong mask, a swapped row/column in the
 * format bits, an off-by-one in the zigzag and a mistyped block table, all of
 * which are invisible to a rendering test.
 */

/** The real thing: what `POST /auth/2fa/setup` answers with. */
const OTPAUTH =
  "otpauth://totp/TradeOs:amina@sparktrading.co.ke?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=TradeOs";

describe("version tables", () => {
  it("has block layouts that add up to the version's codeword count", () => {
    // Each row of the level-M table is self-checking:
    //   sum(blocks * dataPerBlock) + sum(blocks) * ecPerBlock == totalCodewords
    // A single mistyped number breaks it, which is the whole point.
    const expected: Record<number, number> = {
      1: 16,
      2: 28,
      3: 44,
      4: 64,
      5: 86,
      6: 108,
      7: 124,
      8: 154,
      9: 182,
      10: 216,
    };

    for (const [version, dataCodewords] of Object.entries(expected)) {
      expect(dataCodewordsFor(Number(version))).toBe(dataCodewords);
    }
  });

  it("reports the byte capacities the spec lists for level M", () => {
    // Version 10 is where the character-count field grows from 8 bits to 16,
    // which is why its capacity drops relative to the trend (213, not 214).
    expect(capacityFor(1)).toBe(14);
    expect(capacityFor(5)).toBe(84);
    expect(capacityFor(9)).toBe(180);
    expect(capacityFor(10)).toBe(213);
  });

  it("picks the smallest version that holds the payload", () => {
    expect(versionFor(14)).toBe(1);
    expect(versionFor(15)).toBe(2);
    expect(versionFor(213)).toBe(10);
    expect(versionFor(214)).toBeNull();
  });
});

describe("encodeQr", () => {
  it("round-trips a real otpauth URI", () => {
    // The one test that matters. A wrong mask, a transposed format-bit copy,
    // an off-by-one in the zigzag walk or a mistyped block size all survive
    // rendering and all fail here.
    const matrix = encodeQr(OTPAUTH);
    expect(decodeQr(matrix)).toBe(OTPAUTH);
  });

  it("round-trips at every version boundary it supports", () => {
    for (let version = 1; version <= 10; version += 1) {
      const text = "A".repeat(capacityFor(version));
      const matrix = encodeQr(text);
      expect(matrix.version).toBe(version);
      expect(decodeQr(matrix)).toBe(text);
    }
  });

  it("round-trips multi-byte UTF-8, which is bytes and not characters", () => {
    const text = "otpauth://totp/TradeOs:aḿina@shop.example?secret=ABC";
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it("sizes the matrix as 4 × version + 17", () => {
    const matrix = encodeQr(OTPAUTH);
    expect(matrix.size).toBe(matrix.version * 4 + 17);
    expect(matrix.modules).toHaveLength(matrix.size);
    for (const row of matrix.modules) expect(row).toHaveLength(matrix.size);
  });

  it("draws a finder pattern in each of the three corners", () => {
    const { modules, size } = encodeQr(OTPAUTH);

    // The 7x7 finder is a dark ring, a light ring, a 3x3 dark core.
    const isFinder = (top: number, left: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const onRing = r === 0 || r === 6 || c === 0 || c === 6;
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (modules[top + r][left + c] !== (onRing || inCore)) return false;
        }
      }
      return true;
    };

    expect(isFinder(0, 0)).toBe(true);
    expect(isFinder(0, size - 7)).toBe(true);
    expect(isFinder(size - 7, 0)).toBe(true);
    // And not in the fourth corner, which is where alignment lives instead.
    expect(isFinder(size - 7, size - 7)).toBe(false);
  });

  it("alternates the timing patterns and sets the always-dark module", () => {
    const { modules, size } = encodeQr(OTPAUTH);

    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
    // ISO 18004 §6.9.1: (4 × version + 9, 8) is dark in every symbol.
    expect(modules[size - 8][8]).toBe(true);
  });

  it("refuses an empty string and a payload past version 10", () => {
    expect(() => encodeQr("")).toThrow();
    // Silently truncating would produce a code that scans cleanly into the
    // wrong secret — the one failure worth being loud about.
    expect(() => encodeQr("x".repeat(214))).toThrow(/more than this encoder/);
  });
});
