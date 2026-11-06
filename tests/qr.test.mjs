import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { encodeQR, qrSvg } from '../dist/qr.mjs';

// Byte-mode capacities from ISO/IEC 18004 Table 7 (independent of the encoder's own tables): [L, M, Q, H].
const BYTE_CAPACITY = {
  1: [17, 14, 11, 7],
  2: [32, 26, 20, 14],
  3: [53, 42, 32, 24],
  4: [78, 62, 46, 34],
  5: [106, 84, 60, 44],
  6: [134, 106, 74, 58],
  7: [154, 122, 86, 64],
  8: [192, 152, 108, 84],
  9: [230, 180, 130, 98],
  10: [271, 213, 151, 119],
  11: [321, 251, 177, 137],
  15: [520, 412, 292, 220],
  20: [858, 666, 482, 382],
  25: [1273, 997, 715, 535],
  30: [1732, 1370, 982, 742],
  40: [2953, 2331, 1663, 1273],
};
const LEVELS = ['L', 'M', 'Q', 'H'];

const UPI = 'upi://pay?pa=stall.name@okaxis&pn=My%20Awesome%20Stall&am=160.00&cu=INR&tn=Token%20%2307';

/** Deterministic printable-ASCII filler of an exact length. */
function ascii(len, seed = 7) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_.:/?&=%';
  let s = '';
  let x = seed;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += alphabet[(x >>> 16) % alphabet.length];
  }
  return s;
}

/** Rasterises a QR to RGBA (4 px per module, 4-module white quiet zone) and decodes it with jsQR. */
function decode(qr, scale = 4, quiet = 4) {
  const dim = (qr.size + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const row = ((y + quiet) * scale + dy) * dim;
        for (let dx = 0; dx < scale; dx++) {
          const p = (row + (x + quiet) * scale + dx) * 4;
          data[p] = data[p + 1] = data[p + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, dim, dim, { inversionAttempts: 'dontInvert' });
}

function roundTrip(text, opts) {
  const qr = encodeQR(text, opts);
  const result = decode(qr);
  assert.ok(result, `jsQR could not decode v${qr.version}-${qr.ecc} mask ${qr.mask}`);
  assert.deepEqual([...result.binaryData], [...new TextEncoder().encode(text)]);
  assert.equal(result.data, text);
  assert.equal(result.version, qr.version);
  return qr;
}

test('UPI payment URIs round-trip exactly', () => {
  const qr = roundTrip(UPI);
  assert.equal(qr.ecc, 'M');
  assert.equal(qr.size, 17 + 4 * qr.version);
  assert.equal(qr.modules.length, qr.size);
  assert.ok(qr.modules.every(row => row.length === qr.size && row.every(v => typeof v === 'boolean')));
  roundTrip('upi://pay?pa=raju-chaat.corner@ybl&pn=Raju%27s%20Chaat%20Corner&am=1240.50&cu=INR&tn=MYS%20Token%20%23142%20Diwali%20Mela');
  roundTrip('upi://pay?pa=ab@upi&pn=X&cu=INR');
});

test('ASCII lengths force versions 1, 2, 5, 7, 10, 15, 25 and 40 (version info for v>=7)', () => {
  for (const v of [1, 2, 5, 7, 10, 15, 25, 40]) {
    const text = ascii(BYTE_CAPACITY[v][1], v);
    const qr = roundTrip(text, { ecc: 'M' });
    assert.equal(qr.version, v);
  }
});

test('every ECC level round-trips', () => {
  for (const ecc of LEVELS) {
    const qr = roundTrip(UPI, { ecc });
    assert.equal(qr.ecc, ecc);
    // a larger, multi-block symbol at each level
    const big = roundTrip(ascii(BYTE_CAPACITY[10][LEVELS.indexOf(ecc)], 3), { ecc });
    assert.equal(big.version, 10);
  }
});

test('every forced mask 0–7 round-trips', () => {
  for (let mask = 0; mask < 8; mask++) {
    assert.equal(roundTrip(UPI, { mask }).mask, mask);
    assert.equal(roundTrip(ascii(150, mask), { ecc: 'Q', mask }).mask, mask);
  }
  assert.throws(() => encodeQR('x', { mask: 8 }), RangeError);
});

/** Straightforward reference implementation of the ISO penalty rules N1–N4 over a boolean[][] matrix. */
function penalty(m) {
  const n = m.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i].map(Number));
    lines.push(m.map(row => Number(row[i])));
  }
  let score = 0;
  for (const line of lines) {
    const s = line.join('');
    for (const run of s.match(/0+|1+/g)) if (run.length >= 5) score += run.length - 2;
    for (let i = 0; i + 11 <= n; i++) {
      const w = s.slice(i, i + 11);
      if (w === '10111010000' || w === '00001011101') score += 40;
    }
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = m[y][x];
      if (m[y][x + 1] === v && m[y + 1][x] === v && m[y + 1][x + 1] === v) score += 3;
    }
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

test('automatic mask is the lowest-penalty choice and deterministic', () => {
  for (const text of [UPI, 'मसाला चाय ₹20', ascii(300)]) {
    const auto = encodeQR(text);
    assert.deepEqual(encodeQR(text), auto);
    const scores = Array.from({ length: 8 }, (_, mask) => penalty(encodeQR(text, { mask }).modules));
    const best = Math.min(...scores);
    assert.equal(auto.mask, scores.indexOf(best), `scores ${scores.join(',')}`);
    assert.deepEqual(auto.modules, encodeQR(text, { mask: auto.mask }).modules);
  }
});

test('UTF-8 Hindi text round-trips', () => {
  roundTrip('मसाला चाय ₹20');
  roundTrip('पानी पूरी · ₹30 · धन्यवाद! 🙏', { ecc: 'H' });
});

test('empty string encodes as version 1', () => {
  const qr = roundTrip('');
  assert.equal(qr.version, 1);
});

test('chosen version is minimal per the ISO capacity table', () => {
  for (const [v, caps] of Object.entries(BYTE_CAPACITY)) {
    const version = Number(v);
    LEVELS.forEach((ecc, i) => {
      assert.equal(encodeQR(ascii(caps[i]), { ecc }).version, version, `${caps[i]} bytes @ ${ecc}`);
      if (version < 40) {
        assert.equal(encodeQR(ascii(caps[i] + 1), { ecc }).version, version + 1, `${caps[i] + 1} bytes @ ${ecc}`);
      }
    });
  }
  // multi-byte characters count as their UTF-8 bytes: 4 × 3 bytes = 12 fits v1-M (14), 5 × 3 = 15 does not
  assert.equal(encodeQR('₹₹₹₹').version, 1);
  assert.equal(encodeQR('₹₹₹₹₹').version, 2);
});

test('minVersion and maxVersion bound the search', () => {
  assert.equal(encodeQR('hi', { minVersion: 5 }).version, 5);
  assert.equal(roundTrip('hi', { minVersion: 8 }).version, 8);
  assert.throws(() => encodeQR(ascii(100), { maxVersion: 3 }), { message: 'Text is too long for a QR code.' });
  assert.throws(() => encodeQR('x', { minVersion: 0 }), RangeError);
  assert.throws(() => encodeQR('x', { minVersion: 6, maxVersion: 5 }), RangeError);
  assert.throws(() => encodeQR('x', { ecc: 'Z' }), RangeError);
});

test('overflow throws the contract error', () => {
  for (const [i, ecc] of LEVELS.entries()) {
    assert.throws(() => encodeQR(ascii(BYTE_CAPACITY[40][i] + 1), { ecc }), { message: 'Text is too long for a QR code.' });
  }
  assert.throws(() => encodeQR('₹'.repeat(1000)), { message: 'Text is too long for a QR code.' });
});

test('qrSvg structure: viewBox with margin, one rect, one path of horizontal runs, accessible label', () => {
  const qr = encodeQR(UPI);
  const svg = qrSvg(UPI, { label: 'Pay "Raju" <₹160> & co' });
  const n = qr.size + 8;
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes(`viewBox="0 0 ${n} ${n}"`));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="Pay &quot;Raju&quot; &lt;₹160&gt; &amp; co"'));
  assert.equal(svg.match(/<rect/g).length, 1);
  assert.equal(svg.match(/<path/g).length, 1);
  assert.ok(svg.includes(`<rect width="${n}" height="${n}" fill="#ffffff"/>`));
  assert.ok(svg.includes('fill="#171717"'));

  // The path, re-rasterised, reproduces exactly the dark modules (offset by the margin).
  const d = svg.match(/<path d="([^"]*)"/)[1];
  const grid = Array.from({ length: qr.size }, () => new Array(qr.size).fill(false));
  let runs = 0;
  for (const [, x, y, len, back] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    assert.equal(len, back);
    runs++;
    for (let i = 0; i < Number(len); i++) {
      const cx = Number(x) - 4 + i;
      assert.equal(grid[Number(y) - 4][cx], false, 'runs never overlap');
      grid[Number(y) - 4][cx] = true;
    }
  }
  assert.equal(d, d.match(/M\d+ \d+h\d+v1h-\d+z/g).join(''), 'path contains only run segments');
  assert.deepEqual(grid, qr.modules);
  // runs are maximal: no two runs on a row touch
  const maximalRuns = qr.modules.reduce((sum, row) => sum + row.filter((v, x) => v && !row[x - 1]).length, 0);
  assert.equal(runs, maximalRuns);

  const custom = qrSvg('hello', { margin: 2, dark: '#000', light: '#fafafa', ecc: 'H' });
  const size = encodeQR('hello', { ecc: 'H' }).size + 4;
  assert.ok(custom.includes(`viewBox="0 0 ${size} ${size}"`));
  assert.ok(custom.includes('fill="#fafafa"') && custom.includes('fill="#000"'));
  assert.ok(custom.includes('aria-label="QR code"'));
  assert.throws(() => qrSvg(ascii(3000)), { message: 'Text is too long for a QR code.' });
});

test('encoding a ~120-char UPI URI takes < 30 ms (median of 20 runs)', () => {
  const uri = 'upi://pay?pa=stall.name@okaxis&pn=My%20Awesome%20Stall&am=160.00&cu=INR&tn=Token%20%2307%20Diwali%20Mela%20Stall%2010';
  assert.ok(uri.length >= 115 && uri.length <= 125);
  encodeQR(uri); // warm-up
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    encodeQR(uri);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = (times[9] + times[10]) / 2;
  assert.ok(median < 30, `median ${median.toFixed(2)} ms`);
});
