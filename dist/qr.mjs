// @ts-check
/**
 * ManageYourStall — pure QR Code encoder + SVG renderer (ISO/IEC 18004).
 *
 * Scope: byte mode (UTF-8 via TextEncoder), versions 1–40, ECC levels L/M/Q/H, Reed–Solomon over GF(256)
 * (primitive polynomial 0x11D), block split + interleaving, all function patterns, format & version info,
 * and automatic mask selection by the four standard penalty rules.
 *
 * No DOM, no dependencies, deterministic. See ARCHITECTURE.md §6.
 */

import { esc } from './util.mjs';

/** @typedef {'L' | 'M' | 'Q' | 'H'} EccLevel */

/**
 * @typedef {object} QRCode
 * @property {number} version   1–40
 * @property {number} size      modules per side (17 + 4 * version)
 * @property {EccLevel} ecc
 * @property {number} mask      0–7
 * @property {boolean[][]} modules  modules[y][x], true = dark
 */

const TOO_LONG = 'Text is too long for a QR code.';

/** Index of each ECC level in the tables below. */
const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

/** The 2-bit ECC indicator used in the format information. */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// ISO/IEC 18004 Table 9, indexed [eccIndex][version] (index 0 unused).
/** Error-correction codewords per block. */
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Number of error-correction blocks. */
const ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

// ---------------------------------------------------------------------------------------------------------------------
// GF(256) arithmetic and Reed–Solomon
// ---------------------------------------------------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

/** @param {number} a @param {number} b */
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** @type {Map<number, Uint8Array>} */
const generatorCache = new Map();

/**
 * Coefficients of the RS generator polynomial ∏(x − α^i), i = 0..degree−1, highest power first, leading 1 dropped.
 * @param {number} degree
 */
function rsGenerator(degree) {
  const cached = generatorCache.get(degree);
  if (cached) return cached;
  const poly = new Uint8Array(degree);
  poly[degree - 1] = 1; // start with the monomial 1
  let root = 1;
  for (let i = 0; i < degree; i++) {
    // multiply by (x − root)
    for (let j = 0; j < degree; j++) {
      poly[j] = gfMul(poly[j], root);
      if (j + 1 < degree) poly[j] ^= poly[j + 1];
    }
    root = gfMul(root, 2);
  }
  generatorCache.set(degree, poly);
  return poly;
}

/**
 * Reed–Solomon remainder (the ECC codewords) of `data` for the given generator.
 * @param {ArrayLike<number>} data
 * @param {Uint8Array} generator
 */
function rsRemainder(data, generator) {
  const n = generator.length;
  const result = new Uint8Array(n);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[n - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < n; j++) result[j] ^= gfMul(generator[j], factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Number of modules available for data + ECC bits (everything except function patterns and format/version info).
 * @param {number} version
 */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** @param {number} version @param {EccLevel} ecc */
function dataCodewords(version, ecc) {
  const e = ECC_INDEX[ecc];
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[e][version] * ECC_BLOCKS[e][version];
}

/** Character-count indicator width for byte mode. @param {number} version */
function countBits(version) {
  return version <= 9 ? 8 : 16;
}

// ---------------------------------------------------------------------------------------------------------------------
// Codeword construction
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Builds the data codewords (mode + count + payload + terminator + padding).
 * @param {Uint8Array} bytes @param {number} version @param {EccLevel} ecc
 */
function buildDataCodewords(bytes, version, ecc) {
  const capacityBytes = dataCodewords(version, ecc);
  const capacityBits = capacityBytes * 8;
  const out = new Uint8Array(capacityBytes);
  let bitLen = 0;
  /** @param {number} value @param {number} len */
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) {
      if ((value >>> i) & 1) out[bitLen >>> 3] |= 0x80 >>> (bitLen & 7);
      bitLen++;
    }
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bitLen)); // terminator
  bitLen = (bitLen + 7) & ~7; // pad to a byte boundary (bits are already zero)
  for (let pad = 0xec, i = bitLen >>> 3; i < capacityBytes; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
  return out;
}

/**
 * Splits data into blocks, appends ECC to each, and interleaves into the final codeword sequence.
 * @param {Uint8Array} data @param {number} version @param {EccLevel} ecc
 */
function addEccAndInterleave(data, version, ecc) {
  const e = ECC_INDEX[ecc];
  const numBlocks = ECC_BLOCKS[e][version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[e][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortDataLen = Math.floor(rawCodewords / numBlocks) - eccLen;
  const generator = rsGenerator(eccLen);

  /** @type {Uint8Array[]} */
  const dataBlocks = [];
  /** @type {Uint8Array[]} */
  const eccBlocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortDataLen + (i < numShortBlocks ? 0 : 1);
    const block = data.subarray(k, k + len);
    k += len;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, generator));
  }

  const result = new Uint8Array(rawCodewords);
  let p = 0;
  for (let i = 0; i <= shortDataLen; i++) {
    for (const block of dataBlocks) if (i < block.length) result[p++] = block[i];
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of eccBlocks) result[p++] = block[i];
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Centre coordinates of alignment patterns for a version (same list for rows and columns).
 * @param {number} version
 * @returns {number[]}
 */
function alignmentPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** 15-bit format information (ECC level + mask, BCH(15,5), XOR 0x5412). @param {EccLevel} ecc @param {number} mask */
function formatBits(ecc, mask) {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information (BCH(18,6)), for version ≥ 7. @param {number} version */
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Mask predicates, indexed by mask number. @type {Array<(x: number, y: number) => boolean>} */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x, _y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * A square module grid stored row-major in flat typed arrays.
 */
class Grid {
  /** @param {number} version */
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    /** 1 = dark */
    this.dark = new Uint8Array(this.size * this.size);
    /** 1 = function module (not data, never masked) */
    this.reserved = new Uint8Array(this.size * this.size);
  }

  /** @param {number} x @param {number} y @param {boolean | number} dark */
  setFunction(x, y, dark) {
    const i = y * this.size + x;
    this.dark[i] = dark ? 1 : 0;
    this.reserved[i] = 1;
  }

  drawFunctionPatterns() {
    const { size, version } = this;
    // Timing patterns.
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    // Finder patterns with separators.
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    // Alignment patterns (skip the three that overlap finders).
    const pos = alignmentPositions(version);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }
    // Reserve format + version areas (real bits drawn later), including the dark module.
    this.drawFormat(0);
    this.drawVersion();
  }

  /** @param {number} cx @param {number} cy */
  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance: 0–1 dark, 2 light, 3 dark, 4 separator
        this.setFunction(x, y, d !== 2 && d !== 4);
      }
    }
  }

  /** @param {number} cx @param {number} cy */
  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /** Draws both copies of the 15-bit format information plus the dark module. @param {number} bits */
  drawFormat(bits) {
    const size = this.size;
    /** @param {number} i */
    const bit = i => (bits >>> i) & 1;
    // Copy 1, around the top-left finder.
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    // Copy 2, split between the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true); // dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = (bits >>> i) & 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Places codeword bits in the zig-zag order; remainder bits stay light. @param {Uint8Array} codewords */
  drawCodewords(codewords) {
    const size = this.size;
    const totalBits = codewords.length * 8;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const idx = y * size + right - j;
          if (this.reserved[idx]) continue;
          if (i < totalBits) {
            this.dark[idx] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  /** XORs the mask over data modules (self-inverse). @param {number} mask */
  applyMask(mask) {
    const size = this.size;
    const test = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (!this.reserved[idx] && test(x, y)) this.dark[idx] ^= 1;
      }
    }
  }

  /** Total penalty score per ISO/IEC 18004 §7.8.3 (rules N1–N4). */
  penalty() {
    const size = this.size;
    const m = this.dark;
    let score = 0;

    // N1 (runs ≥ 5) and N3 (1:1:3:1:1 finder-like pattern with 4 light modules on one side), rows then columns.
    for (let pass = 0; pass < 2; pass++) {
      const strideA = pass === 0 ? size : 1; // between lines
      const strideB = pass === 0 ? 1 : size; // along a line
      for (let a = 0; a < size; a++) {
        const base = a * strideA;
        let runColor = -1;
        let runLen = 0;
        let pattern = 0; // last 11 modules as bits, newest in bit 0
        for (let b = 0; b < size; b++) {
          const v = m[base + b * strideB];
          if (v === runColor) {
            runLen++;
          } else {
            if (runLen >= 5) score += 3 + (runLen - 5);
            runColor = v;
            runLen = 1;
          }
          pattern = ((pattern << 1) | v) & 0x7ff;
          if (b >= 10 && (pattern === 0b10111010000 || pattern === 0b00001011101)) score += 40;
        }
        if (runLen >= 5) score += 3 + (runLen - 5);
      }
    }

    // N2: 2×2 blocks of one colour.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const i = y * size + x;
        const v = m[i];
        if (v === m[i + 1] && v === m[i + size] && v === m[i + size + 1]) score += 3;
      }
    }

    // N4: dark/light balance, 10 points per full 5% deviation from 50%.
    let darkCount = 0;
    for (let i = 0; i < m.length; i++) darkCount += m[i];
    score += Math.floor(Math.abs((darkCount * 100) / m.length - 50) / 5) * 10;

    return score;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {unknown} value @param {string} name
 * @returns {number}
 */
function versionOption(value, name) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1 || v > 40) throw new RangeError(`${name} must be an integer from 1 to 40.`);
  return v;
}

/**
 * Encodes text as a QR Code symbol (byte mode, UTF-8), choosing the smallest version in [minVersion, maxVersion]
 * that fits, and the mask with the lowest penalty unless `mask` forces one.
 *
 * @param {string} text
 * @param {{ ecc?: EccLevel, minVersion?: number, maxVersion?: number, mask?: number }} [opts]
 *   `mask` (0–7) forces a specific mask pattern; omit it (or pass -1) for automatic selection.
 * @returns {QRCode}
 * @throws {Error} 'Text is too long for a QR code.' when no allowed version can hold the text.
 */
export function encodeQR(text, opts = {}) {
  const ecc = /** @type {EccLevel} */ (String(opts.ecc ?? 'M').toUpperCase());
  if (!Object.hasOwn(ECC_INDEX, ecc)) throw new RangeError(`Unknown ECC level: ${opts.ecc}`);
  const minVersion = versionOption(opts.minVersion ?? 1, 'minVersion');
  const maxVersion = versionOption(opts.maxVersion ?? 40, 'maxVersion');
  if (minVersion > maxVersion) throw new RangeError('minVersion must not exceed maxVersion.');
  const forcedMask = opts.mask ?? -1;
  if (forcedMask !== -1 && !(Number.isInteger(forcedMask) && forcedMask >= 0 && forcedMask <= 7)) {
    throw new RangeError('mask must be an integer from 0 to 7.');
  }

  const bytes = new TextEncoder().encode(String(text ?? ''));

  let version = -1;
  for (let v = minVersion; v <= maxVersion; v++) {
    const bitsNeeded = 4 + countBits(v) + bytes.length * 8;
    if (bitsNeeded <= dataCodewords(v, ecc) * 8) {
      version = v;
      break;
    }
  }
  if (version < 0) throw new Error(TOO_LONG);

  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, ecc), version, ecc);
  const grid = new Grid(version);
  grid.drawFunctionPatterns();
  grid.drawCodewords(codewords);

  let mask = forcedMask;
  if (mask === -1) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      grid.applyMask(candidate);
      grid.drawFormat(formatBits(ecc, candidate));
      const score = grid.penalty();
      if (score < best) {
        best = score;
        mask = candidate;
      }
      grid.applyMask(candidate); // undo (XOR is self-inverse)
    }
  }
  grid.applyMask(mask);
  grid.drawFormat(formatBits(ecc, mask));

  const size = grid.size;
  /** @type {boolean[][]} */
  const modules = [];
  for (let y = 0; y < size; y++) {
    const row = new Array(size);
    for (let x = 0; x < size; x++) row[x] = grid.dark[y * size + x] === 1;
    modules.push(row);
  }
  return { version, size, ecc, mask, modules };
}

/**
 * Renders text as a QR Code SVG string: one background `<rect>` and one `<path>` of dark modules built from
 * horizontal runs. The SVG has no width/height so it scales to its container.
 *
 * @param {string} text
 * @param {{ ecc?: EccLevel, margin?: number, dark?: string, light?: string, label?: string,
 *   minVersion?: number, maxVersion?: number, mask?: number }} [opts]
 * @returns {string}
 */
export function qrSvg(text, opts = {}) {
  const { margin = 4, dark = '#171717', light = '#ffffff', label = 'QR code' } = opts;
  const qr = encodeQR(text, { ecc: opts.ecc, minVersion: opts.minVersion, maxVersion: opts.maxVersion, mask: opts.mask });
  const m = Math.max(0, Math.floor(Number(margin) || 0));
  const n = qr.size + 2 * m;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    const row = qr.modules[y];
    for (let x = 0; x < qr.size; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < qr.size && row[end]) end++;
      const len = end - x;
      d += `M${x + m} ${y + m}h${len}v1h-${len}z`;
      x = end;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}">` +
    `<rect width="${n}" height="${n}" fill="${esc(light)}"/>` +
    `<path d="${d}" fill="${esc(dark)}"/>` +
    `</svg>`
  );
}
