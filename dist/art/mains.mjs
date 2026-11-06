// @ts-check
// Illustration batch: mains — pizzas, burger, grilled sandwich, momos, noodles, pav bhaji, chole bhature, frankie.
// Neo-Brutalist food stickers per ARCHITECTURE.md §7: bold ink outlines, flat palette fills, a hard +4,+4 ink
// shadow under every main silhouette and cream highlight strokes. Each `svg` is inner markup for a 0 0 150 150
// viewBox; library.mjs adds the <svg> wrapper and the soft ground shadow at y≈136.
// The markup is generated once at import time by the small pure string helpers below (deterministic output).

const INK = '#171717';
const YELLOW = '#ffdd35';
const PINK = '#ff4d87';
const CORAL = '#ff6b5b';
const ORANGE = '#ff9f43';
const MINT = '#7ee0b5';
const LIME = '#b9f36b';
const GREEN = '#42934b';
const LAVENDER = '#c7b6ff';
const SKY = '#8fd3ff';
const CREAM = '#fff9ed';
const CRUST = '#e8a54b';
const GOLD = '#f6b43b';
const BROWN = '#9b633e';
const DARK = '#5a3a22';
const RED = '#eb4235';
const WHITE = '#ffffff';

// ---------------------------------------------------------------------------------------------------------------
// Drawing helpers (pure string builders)

/** Round to one decimal so generated path data stays short. @param {number} v */
const n = v => Math.round(v * 10) / 10;

/**
 * Point on a circle; angle in degrees, clockwise from 3 o'clock.
 * @param {number} cx @param {number} cy @param {number} r @param {number} deg
 * @returns {[number, number]}
 */
const polar = (cx, cy, r, deg) => [n(cx + r * Math.cos((deg * Math.PI) / 180)), n(cy + r * Math.sin((deg * Math.PI) / 180))];

/**
 * Ellipse as path data, so ellipses can share the shape / shadow / rope helpers.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 */
const ell = (cx, cy, rx, ry) => `M${n(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${n(2 * rx)} 0a${rx} ${ry} 0 1 0 ${n(-2 * rx)} 0Z`;

/** Filled shape with an ink outline. @param {string} d @param {string} fill @param {number} [w] outline width */
const shape = (d, fill, w = 3) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

/** Flat fill without an outline. @param {string} d @param {string} fill */
const flat = (d, fill) => `<path d="${d}" fill="${fill}"/>`;

/** Ink outline only (redrawn over inner fills that cover half of an outline). @param {string} d @param {number} [w] */
const outline = (d, w = 2.5) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

/** Open round-capped stroke (details, grill marks). @param {string} d @param {string} [color] @param {number} [w] */
const line = (d, color = INK, w = 2) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Cream highlight stroke. @param {string} d @param {number} [w] */
const shine = (d, w = 3.5) => line(d, CREAM, w);

/**
 * Thick coloured stroke with an ink edge (noodles, steam, crust, capsicum, onion rings).
 * @param {string} d @param {string} color @param {number} [w] colour width @param {number} [edge] extra ink width (both sides)
 */
const rope = (d, color, w = 4, edge = 3) => line(d, INK, w + edge) + line(d, color, w);

/**
 * Hard offset shadow: the silhouette filled with ink, shifted +4,+4 on screen.
 * @param {string} d @param {string} [then] transform applied to the silhouette first, e.g. ' rotate(30 75 78)'
 */
const shadow = (d, then = '') =>
  `<path d="${d}" transform="translate(4 4)${then}" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;

/**
 * Circles of one colour (seeds, specks, peas, chickpeas).
 * @param {string} fill @param {number} r default radius @param {number[][]} points [x, y] or [x, y, radius]
 * @param {number} [ink] ink outline width (0 = none)
 */
const dots = (fill, r, points, ink = 0) =>
  `<g fill="${fill}"${ink ? ` stroke="${INK}" stroke-width="${ink}"` : ''}>`
  + points.map(([x, y, radius = r]) => `<circle cx="${x}" cy="${y}" r="${radius}"/>`).join('')
  + '</g>';

/**
 * Ellipses of one colour (sesame seeds, golden-brown patches).
 * @param {string} fill @param {number[][]} list [x, y, rx, ry, rotation?] @param {number} [ink] ink outline width (0 = none)
 */
const ovals = (fill, list, ink = 0) =>
  `<g fill="${fill}"${ink ? ` stroke="${INK}" stroke-width="${ink}"` : ''}>`
  + list.map(([x, y, rx, ry, a = 0]) => {
    const turn = a ? ` transform="rotate(${a} ${x} ${y})"` : '';
    return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"${turn}/>`;
  }).join('')
  + '</g>';

/**
 * Small pointed leaf (coriander, basil) from (x, y): w long, 2h wide.
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
const leaf = (x, y, w, h) => `M${x} ${y}q${n(w / 2)} ${-h} ${w} 0q${n(-w / 2)} ${h} ${-w} 0Z`;

/** Four-point sparkle. @param {number} x @param {number} y @param {number} [s] @param {string} [fill] */
function sparkle(x, y, s = 8, fill = YELLOW) {
  const k = n(s * 0.24);
  const d = `M${x} ${y - s}Q${n(x + k)} ${n(y - k)} ${x + s} ${y}Q${n(x + k)} ${n(y + k)} ${x} ${y + s}`
    + `Q${n(x - k)} ${n(y + k)} ${x - s} ${y}Q${n(x - k)} ${n(y - k)} ${x} ${y - s}Z`;
  return shape(d, fill, 2);
}

/** Wavy steam wisp rising from (x, y). @param {number} x @param {number} y @param {number} [h] */
const steam = (x, y, h = 24) => rope(`M${x} ${y}q-6 ${n(-h / 4)} 0 ${n(-h / 2)}t0 ${n(-h / 2)}`, CREAM, 3.5, 3.5);

/**
 * Closed outline with soft scallops around an ellipse (puffy crusts, melted cheese, bhatura, lettuce).
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 * @param {number} bumps @param {number} amp bump height @param {number} [turn] start angle (radians)
 */
function wavy(cx, cy, rx, ry, bumps, amp, turn = 0) {
  let d = '';
  for (let i = 0; i <= bumps; i++) {
    const a = turn + (i / bumps) * 2 * Math.PI;
    const x = n(cx + rx * Math.cos(a));
    const y = n(cy + ry * Math.sin(a));
    if (i === 0) {
      d = `M${x} ${y}`;
      continue;
    }
    const m = turn + ((i - 0.5) / bumps) * 2 * Math.PI;
    d += `Q${n(cx + (rx + 2 * amp) * Math.cos(m))} ${n(cy + (ry + 2 * amp) * Math.sin(m))} ${x} ${y}`;
  }
  return `${d}Z`;
}

/**
 * Bumpy dome outline (top half of an ellipse, left to right, left open) — a heap of noodles.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} bumps @param {number} amp
 */
function mound(cx, cy, rx, ry, bumps, amp) {
  let d = `M${n(cx - rx)} ${cy}`;
  for (let i = 1; i <= bumps; i++) {
    const a = Math.PI + (i / bumps) * Math.PI;
    const m = Math.PI + ((i - 0.5) / bumps) * Math.PI;
    const control = `${n(cx + (rx + 2 * amp) * Math.cos(m))} ${n(cy + (ry + 2 * amp) * Math.sin(m))}`;
    d += `Q${control} ${n(cx + rx * Math.cos(a))} ${n(cy + ry * Math.sin(a))}`;
  }
  return d;
}

/**
 * Tight wave from x0 to x1 at height y (an instant-noodle squiggle).
 * @param {number} x0 @param {number} x1 @param {number} y @param {number} [amp]
 */
function squiggle(x0, x1, y, amp = 2.4) {
  const count = Math.max(2, Math.round((x1 - x0) / 5));
  const s = n((x1 - x0) / count);
  return `M${x0} ${y}q${n(s / 2)} ${n(-2 * amp)} ${s} 0` + `t${s} 0`.repeat(count - 1);
}

/**
 * One momo: a soft dome whose pleats swirl up into a small gathered nub.
 * @param {number} x @param {number} y centre @param {number} w @param {number} h
 * @param {string} fill @param {string} [base] colour of a crisp fried base ('' = none)
 */
function momo(x, y, w, h, fill, base = '') {
  const L = n(x - w / 2);
  const R = n(x + w / 2);
  const T = n(y - h / 2);
  const B = n(y + h / 2);
  const mid = n(y + h * 0.16);
  const shoulder = n(y - h * 0.24);
  const body = `M${L} ${mid}C${L} ${shoulder} ${n(x - w * 0.24)} ${T} ${x} ${T}`
    + `C${n(x + w * 0.24)} ${T} ${R} ${shoulder} ${R} ${mid}Q${R} ${B} ${x} ${B}Q${L} ${B} ${L} ${mid}Z`;
  let out = shape(body, fill, 2.5);
  if (base) {
    const rim = n(mid - h * 0.08);
    out += flat(`M${L} ${rim}Q${L} ${B} ${x} ${B}Q${R} ${B} ${R} ${rim}Q${x} ${n(B - h * 0.3)} ${L} ${rim}Z`, base);
    out += outline(body);
  }
  let pleats = '';
  for (const f of [-0.34, -0.17, 0, 0.17, 0.34]) {
    const bend = `${n(x + w * f * 0.55 + w * 0.09)} ${n(y - h * 0.22)}`; // control pushed right: the pleats swirl
    pleats += `M${n(x + f * 6)} ${n(T + 2)}Q${bend} ${n(x + w * f)} ${n(y + h * 0.08 - Math.abs(f) * h * 0.3)}`;
  }
  out += line(pleats, INK, 1.7);
  out += shape(`M${n(x - 4.5)} ${n(T + 2)}Q${n(x - 4)} ${n(T - 4)} ${n(x + 1)} ${n(T - 4.5)}`
    + `Q${n(x + 4.5)} ${n(T - 4)} ${n(x + 4.5)} ${n(T + 2)}Z`, fill, 2);
  out += shine(`M${n(L + 4.5)} ${n(mid - 1)}Q${n(L + 4)} ${n(y - h * 0.16)} ${n(x - w * 0.24)} ${n(T + 5)}`, 2.6);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Illustrations

/** Whole veg pizza, top view: puffy crust, sauce rim, melted cheese and six slices of veggies. */
function vegPizza() {
  const cx = 73;
  const cy = 75;
  const rim = wavy(cx, cy, 54, 54, 20, 1.4);
  /** Place a topping at polar (r, deg) from the centre. @param {number} r @param {number} deg @param {number} rot @param {string} art */
  const put = (r, deg, rot, art) => {
    const [x, y] = polar(cx, cy, r, deg);
    return `<g transform="translate(${x} ${y}) rotate(${rot})">${art}</g>`;
  };
  const tomato = `<circle r="7.5" fill="${RED}" stroke="${INK}" stroke-width="2"/><circle r="4.3" fill="${CORAL}"/>`
    + dots(CREAM, 1.1, [[-1.7, -1.2], [1.9, 1]]);
  const olive = `<circle r="3.9" fill="none" stroke="${INK}" stroke-width="2.8"/>`;
  const capsicum = rope('M-7 3Q0-9 7 3', GREEN, 3.6, 3);
  const onion = rope('M-7 2Q0-6 7 2', LAVENDER, 3, 3);
  const paneer = `<rect x="-4.6" y="-4.6" width="9.2" height="9.2" rx="1.6" fill="${WHITE}" stroke="${INK}" stroke-width="2"/>`;
  // three cuts through the centre make six slices
  const cuts = [15, 75, 135].map(a => `M${polar(cx, cy, 46, a).join(' ')}L${polar(cx, cy, 46, a + 180).join(' ')}`).join('');
  const crustShine = `M${polar(cx, cy, 49, 198).join(' ')}A49 49 0 0 1 ${polar(cx, cy, 49, 250).join(' ')}`;
  return [
    sparkle(124, 21, 9),
    sparkle(22, 22, 6, PINK),
    shadow(rim),
    shape(rim, CRUST),
    line(crustShine, CREAM, 3),
    `<circle cx="${cx}" cy="${cy}" r="45" fill="${RED}" stroke="${INK}" stroke-width="2"/>`,
    shape(wavy(cx, cy, 38.5, 38.5, 9, 2.6, 0.35), YELLOW, 2),
    line(cuts, INK, 2.2),
    put(31, 38, 0, tomato), put(19, 52, 0, olive),
    put(31, 104, 20, capsicum), put(20, 108, 15, paneer),
    put(31, 168, -75, onion), put(19, 160, 0, olive),
    put(30, 228, 0, tomato), put(19, 214, -30, capsicum),
    put(31, 290, 12, paneer), put(19, 274, 0, olive),
    put(31, 346, 80, capsicum), put(19, 334, 40, onion),
  ].join('');
}

/** Cheese pizza: a slice lifted off the pie, molten cheese dripping and stretching below it. */
function cheesePizza() {
  // slice with three cheese drips along its lower edge, tip at the bottom left
  const body = 'M58 27Q104 15 125 66L107.6 74.4C108 88 98 92 98 79L84.1 85.7C85 104 76 106 76.3 89.5'
    + 'L64.1 95.4C65 110 57 111 57.1 98.8L42 106Q33 112 35 102Z';
  const crust = 'M55 23Q107 8 128 60';
  const strand = 'M80.4 99Q75 107 80 113T78.5 120';
  return [
    sparkle(24, 30, 9),
    sparkle(126, 104, 6, PINK),
    '<g transform="translate(-2 5)">',
    `<path d="${crust}" transform="translate(4 4)" fill="none" stroke="${INK}" stroke-width="19" stroke-linecap="round"/>`,
    shadow(body),
    // gooey cheese: one long strand ending in a drop, one sagging loop from a drip back to the tip
    line(strand, INK, 6),
    shape(ell(78.5, 122.5, 3.8, 4.2), YELLOW, 2),
    line(strand, YELLOW, 3),
    rope('M60.5 105Q49 129 36 104', YELLOW, 2.8, 3),
    shape(body, YELLOW, 3),
    dots(RED, 6, [[76, 48, 7], [102, 56], [60, 80]], 2),
    flat(leaf(84, 70, 10, 6) + leaf(66, 62, 9, 5), GREEN),
    shine('M64 38Q72 33 82 33', 3),
    dots(CREAM, 1.8, [[90, 42, 2], [54, 64], [86, 80]]),
    rope(crust, CRUST, 13, 6),
    shine('M66 17Q96 9 116 31', 3),
    dots(BROWN, 1.5, [[80, 20], [101, 27], [118, 44]]),
    '</g>',
  ].join('');
}

/** Tall veg burger: sesame bun, lettuce, tomato, cheese drip, patty and a flag pick. */
function burger() {
  const silhouette = 'M28 64C28 33 47 21 75 21C103 21 122 33 122 64L126 66L126 104L120 106L119 116Q118 126 108 126'
    + 'L42 126Q32 126 31 116L30 106L24 104L24 66Z';
  const top = 'M28 64C28 33 47 21 75 21C103 21 122 33 122 64Q122 70 116 70L34 70Q28 70 28 64Z';
  const bun = 'M30 104Q30 99 36 99L114 99Q120 99 120 104L119 116Q118 126 108 126L42 126Q32 126 31 116Z';
  const patty = 'M25 90Q25 84 31 84L119 84Q125 84 125 90L125 98Q125 104 119 104L31 104Q25 104 25 98Z';
  const cheese = 'M27 81L123 81L123 88L111 88L105 98L99 88L64 88L57 100L50 88L27 88Z';
  const tomatoes = 'M30 77Q30 73 35 73L71 73Q76 73 76 77L76 79Q76 83 71 83L35 83Q30 83 30 79Z'
    + 'M74 77Q74 73 79 73L115 73Q120 73 120 77L120 79Q120 83 115 83L79 83Q74 83 74 79Z';
  // lettuce: a band whose lower edge frills into ten scallops
  let lettuce = 'M24 64L126 64L126 71';
  for (let i = 0; i < 10; i++) {
    lettuce += `Q${n(126 - 10.2 * i - 5.1)} ${i % 2 ? 76 : 80} ${n(126 - 10.2 * (i + 1))} 71`;
  }
  lettuce += 'Z';
  const seeds = [
    [50, 40, -25], [64, 33, -8], [82, 32, 8], [98, 38, 25], [58, 51, -15],
    [76, 45, 0], [93, 51, 18], [42, 54, -35], [107, 53, 35],
  ].map(([x, y, a]) => [x, y, 3.2, 1.8, a]);
  return [
    sparkle(23, 34, 8),
    sparkle(128, 30, 6, PINK),
    '<g transform="rotate(-5 75 76)">',
    shadow(silhouette),
    shape(bun, GOLD),
    shine('M38 106L39 117', 3),
    shape(patty, BROWN),
    dots(DARK, 1.8, [[36, 94], [46, 98], [70, 94], [84, 99], [92, 93], [116, 95]]),
    shape(cheese, YELLOW, 2.5),
    shape(tomatoes, RED, 2.5),
    shape(lettuce, LIME, 2.5),
    shape(top, GOLD),
    ovals(CREAM, seeds, 1.5),
    shine('M37 57Q37 38 53 30', 4),
    rope('M75 24V12', CRUST, 2.4, 2.6),
    shape('M75 11L93 15.5L75 20Z', PINK, 2),
    '</g>',
  ].join('');
}

/** One sandwich half in local coordinates: the top-face triangle sitting on its cut-face band. */
const HALF = 'M-46 0L0-42L46 0L46 18Q46 22 42 22L-42 22Q-46 22-46 18Z';
const HALF_BAND = 'M-46 0L46 0L46 18Q46 22 42 22L-42 22Q-46 22-46 18Z';
const HALF_TOP = 'M-46 0L0-42L46 0Z';

/**
 * One toasted triangle half: grill-marked top face, cut face showing green chutney and cheese.
 * @param {number} tx @param {number} ty @param {number} rot
 */
function sandwichHalf(tx, ty, rot) {
  return [
    shadow(HALF, ` translate(${tx} ${ty}) rotate(${rot})`),
    `<g transform="translate(${tx} ${ty}) rotate(${rot})">`,
    // cut face: crumb, green chutney, cheese with two drips, toasted bottom crust
    flat(HALF_BAND, CREAM),
    shape('M-46 6H46V10.5H-46Z', GREEN, 1.5),
    shape('M-46 10.5H46V14.5H26Q24 19.5 21 14.5H-8Q-10 20.5-13 14.5H-46Z', YELLOW, 1.5),
    shape('M-46 18H46Q46 22 42 22H-42Q-46 22-46 18Z', CRUST, 1.5),
    outline(HALF_BAND),
    // top face: crust border, golden toast, grill marks
    flat(HALF_TOP, CRUST),
    flat('M-36 0L0-33L36 0Z', GOLD),
    line('M-22.2-1.8L2.9-26.9M-8.2-1.8L10.2-20.2M5.8-1.8L17.5-13.5M19.8-1.8L24.8-6.8', DARK, 3.6),
    shine('M-38-5L-13-28', 2.6),
    outline(HALF_TOP),
    '</g>',
  ].join('');
}

/** Grilled sandwich: two toasted triangle halves, one leaning behind the other. */
function grilledSandwich() {
  return [sparkle(24, 30, 8), sparkle(126, 108, 6, PINK), sandwichHalf(86, 64, 16), sandwichHalf(68, 102, -5)].join('');
}

/** Steamed momos: three pale pleated momos in a bamboo steamer, steam rising. */
function steamedMomos() {
  const y = 88; // rim centre line of the steamer
  const wall = `M23 ${y}A52 14 0 0 0 127 ${y}L123 117Q75 134 27 117Z`;
  // bamboo slats run from just under the rim's front edge to just above the base curve
  let slats = '';
  for (const x of [38, 54, 75, 96, 112]) {
    const t = (x - 27) / 96;
    slats += `M${x} ${n(y + 14 * Math.sqrt(1 - ((x - 75) / 52) ** 2) + 4)}L${x} ${n(117 + 34 * t * (1 - t) - 4)}`;
  }
  return [
    steam(50, 54, 26),
    steam(76, 46, 26),
    steam(101, 54, 26),
    shadow(`M23 ${y}A52 14 0 0 1 127 ${y}L123 117Q75 134 27 117Z`),
    `<ellipse cx="75" cy="${y}" rx="52" ry="14" fill="${DARK}"/>`,
    rope(ell(75, y, 52, 14), CRUST, 5, 5),
    momo(52, 78, 36, 32, WHITE),
    momo(98, 78, 36, 32, WHITE),
    momo(75, 92, 40, 34, WHITE),
    shape(wall, CRUST),
    line(slats, BROWN, 2.2),
    line('M25 103Q75 123 125 103', DARK, 2.5),
    rope(`M23 ${y}A52 14 0 0 0 127 ${y}`, CRUST, 5, 5),
    shine('M31 108Q33 114 38 117', 3),
  ].join('');
}

/** Fried momos: three golden momos with crisp brown bases on a plate, red chutney dip on the side. */
function friedMomos() {
  const dip = 'M94 108A17 5.5 0 0 0 128 108Q127 124 111 125Q95 124 94 108Z';
  return [
    sparkle(24, 34, 8),
    sparkle(124, 30, 7, PINK),
    shadow(ell(68, 108, 54, 18)),
    shape(ell(68, 108, 54, 18), MINT),
    `<ellipse cx="68" cy="106" rx="42" ry="11" fill="none" stroke="${INK}" stroke-width="1.5"/>`,
    shine('M22 104Q25 97 38 94', 3),
    momo(48, 86, 38, 32, GOLD, CRUST),
    momo(90, 84, 38, 32, GOLD, CRUST),
    momo(68, 99, 42, 34, GOLD, CRUST),
    // crisp fried blisters
    dots(BROWN, 1.3, [[39, 85], [57, 80], [83, 80], [100, 84], [56, 99], [80, 98], [62, 108], [74, 110], [45, 95], [96, 93]]),
    shadow('M94 108A17 5.5 0 0 1 128 108Q127 124 111 125Q95 124 94 108Z'),
    shape(dip, WHITE, 2.5),
    `<ellipse cx="111" cy="108" rx="17" ry="5.5" fill="${RED}" stroke="${INK}" stroke-width="2.5"/>`,
    `<ellipse cx="105" cy="107" rx="4" ry="1.4" fill="${CORAL}"/>`,
    shine('M98 113Q100 119 106 121', 2.5),
  ].join('');
}

/** Masala noodles: a heaped bowl of wavy noodles with peas and carrots, a fork twirling a bite. */
function maggi() {
  const y = 84; // rim centre line of the bowl
  const bowl = `M22 ${y}A53 13 0 0 0 128 ${y}C127 108 108 124 75 125C42 124 23 108 22 ${y}Z`;
  const heap = mound(75, y, 47, 27, 8, 2.4);
  const waves = [squiggle(52, 98, 63), squiggle(40, 110, 71), squiggle(32, 118, 79), squiggle(36, 114, 88)].join('');
  const hang = 'q-4 5 0 10t0 10';
  const carrots = [[56, 78, 20], [98, 68, -15], [78, 86, 0]]
    .map(([x, top, a]) => `<rect x="${x}" y="${top}" width="5.5" height="5.5" transform="rotate(${a} ${n(x + 2.75)} ${n(top + 2.75)})"/>`)
    .join('');
  return [
    steam(38, 58, 24),
    steam(54, 50, 22),
    shadow(`M22 ${y}A53 13 0 0 1 128 ${y}C127 108 108 124 75 125C42 124 23 108 22 ${y}Z`),
    shape('M57 118H93L96 128H54Z', SKY, 2.5),
    `<ellipse cx="75" cy="${y}" rx="53" ry="13" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>`,
    // strands hanging from the fork, tucked under the heap
    rope(`M84 46${hang}M92 48${hang}M100 46${hang}`, YELLOW, 3, 3),
    flat(`${heap}Z`, YELLOW),
    line(heap, INK, 2.5),
    line(waves, CRUST, 2.3),
    shine(squiggle(46, 66, 66, 1.8), 2),
    dots(GREEN, 3.2, [[48, 74], [66, 66], [110, 78]], 1.5),
    `<g fill="${ORANGE}" stroke="${INK}" stroke-width="1.5">${carrots}</g>`,
    // fork handle and the twirled bite
    rope('M121 15L101 37', WHITE, 6, 3),
    '<g transform="rotate(-25 92 42)">',
    shape(ell(92, 42, 15, 9), YELLOW, 2.5),
    line(squiggle(80, 104, 40, 1.8) + squiggle(83, 101, 46, 1.6), CRUST, 2),
    '</g>',
    shape(bowl, SKY),
    dots(CREAM, 3, [[36, 100], [54, 109], [75, 112], [96, 109], [114, 100]]),
  ].join('');
}

/** Pav bhaji: orange-red bhaji with a melting butter cube, two glossy pav, lemon and onion on a steel plate. */
function pavBhaji() {
  const bhaji = 'M54 104Q48 92 60 86Q64 74 80 76Q90 66 104 73Q120 72 123 86Q132 96 122 105Q88 115 54 104Z';
  // a joined pair of soft pav: golden sides, glossy butter-toasted domes
  const pav = [
    shape('M14 100V85Q14 70 28 70Q37 70 40 76Q43 70 52 70Q66 70 66 85V100Q40 105 14 100Z', GOLD, 2.5),
    shape('M14 87Q14 70 28 70Q40 70 40 82V89Q26 94 14 87Z', CRUST, 2.5),
    shape('M40 89V82Q40 70 52 70Q66 70 66 87Q54 94 40 89Z', CRUST, 2.5),
    line('M40 89V102', INK, 2),
    shine('M19 82Q19 75 27 74M45 81Q45 75 52 74', 3),
    shine('M18 92V97', 2.5),
  ].join('');
  const onions = [[58, 110], [66, 114], [74, 111]].map(([x, y]) => `<rect x="${x}" y="${y}" width="4.5" height="4.5"/>`).join('');
  return [
    steam(100, 60, 26),
    steam(116, 66, 22),
    shadow(ell(75, 110, 57, 19)),
    shape(ell(75, 110, 57, 19), WHITE),
    `<ellipse cx="75" cy="108" rx="45" ry="13" fill="none" stroke="${INK}" stroke-width="1.6"/>`,
    `<g transform="translate(2 0) rotate(-6 40 100)">${pav}</g>`,
    shape(bhaji, CORAL, 2.5),
    dots(RED, 2.5, [[66, 94, 3], [78, 100], [112, 96, 3], [100, 102, 2.4], [72, 84, 2.2]]),
    line('M62 90q3-6 10-6M106 80q6-1 9 4', ORANGE, 3),
    // butter cube melting into the bhaji
    shape('M84 80q-3 8 3 9t9-3q2-5-2-7Z', YELLOW, 2),
    shape('M82 71l9-5 9 5-9 5Z', CREAM, 2),
    shape('M82 71l9 5v8l-9-5Z', YELLOW, 2),
    shape('M91 76l9-5v8l-9 5Z', GOLD, 2),
    flat(leaf(66, 100, 8, 5) + leaf(108, 88, 8, 5) + leaf(96, 96, 7, 4), GREEN),
    `<g fill="${LAVENDER}" stroke="${INK}" stroke-width="1.5">${onions}</g>`,
    '<g transform="rotate(-12 37 108)">',
    shape('M26 108A11 11 0 0 0 48 108Z', YELLOW, 2),
    line('M37 108L32 116M37 108V118M37 108L42 116', CREAM, 1.6),
    '</g>',
  ].join('');
}

/** Chole bhature: a big puffed bhatura behind a bowl of chole topped with an onion ring and a green chilli. */
function choleBhature() {
  // the bhatura: a wide puffed pillow with a bubbly fried edge over a thin, crisper (darker) rim
  const skirt = wavy(57, 72, 46, 20, 15, 1.4);
  const puff = wavy(57, 56, 44, 31, 11, 1.6, 0.2);
  const tilt = ' translate(3 0) rotate(-8 57 60)';
  const bowl = 'M64 98A33 9 0 0 0 130 98Q128 125 97 126Q66 125 64 98Z';
  return [
    steam(120, 82, 24),
    shadow(skirt, tilt),
    shadow(puff, tilt),
    `<g transform="${tilt.trim()}">`,
    shape(skirt, CRUST),
    shape(puff, GOLD),
    flat('M95.6 49A40 27 0 0 1 40.1 80.5Q86 74 95.6 49Z', CRUST),
    ovals(CRUST, [[44, 44, 6, 3.4, -20], [70, 38, 4.5, 2.6], [36, 64, 4, 2.4, 25], [62, 57, 6.5, 3.6, 10]]),
    dots(BROWN, 1.3, [[52, 40], [78, 50], [46, 70], [30, 50], [66, 70]]),
    shine('M23 58Q22 40 40 31', 5),
    `<circle cx="50" cy="30" r="2.2" fill="${CREAM}"/>`,
    '</g>',
    shadow('M64 98A33 9 0 0 1 130 98Q128 125 97 126Q66 125 64 98Z'),
    shape(bowl, LAVENDER),
    `<ellipse cx="97" cy="98" rx="33" ry="9" fill="${BROWN}" stroke="${INK}" stroke-width="2.5"/>`,
    dots(CRUST, 4.2, [[82, 96], [91, 92], [101, 94], [111, 92], [119, 97], [88, 101], [99, 100], [109, 101]], 1.5),
    rope(ell(98, 93, 6, 3.5), WHITE, 2.4, 2.4),
    rope('M108 89q8-4 14 3', GREEN, 3.6, 3),
    flat(leaf(84, 92, 7, 4) + leaf(110, 99, 7, 4), GREEN),
    shine('M70 104Q72 116 82 120', 3),
  ].join('');
}

/** Frankie roll: a fat paratha wrap bursting with lettuce, onion rings and sauce, half wrapped in paper. */
function frankieRoll() {
  const turn = ' rotate(30 75 78)';
  const greens = wavy(75, 32, 23, 14, 9, 1.8);
  const body = 'M54 46A21 7 0 0 0 96 46V114Q96 126 75 126Q54 126 54 114Z';
  const paper = 'M51 82L99 96V116Q99 130 75 130Q51 130 51 116Z';
  return [
    sparkle(28, 32, 9),
    sparkle(122, 110, 6, PINK),
    shadow(greens, turn),
    shadow(body, turn),
    shadow(paper, turn),
    `<g transform="${turn.trim()}">`,
    // filling bursting from the open end: lettuce, onion rings, carrot sticks, chilli and a sauce drizzle
    shape(greens, LIME, 2.5),
    rope(ell(64, 31, 5.5, 3.6) + ell(86, 25, 5.5, 3.6), LAVENDER, 2.4, 2.4),
    rope('M73 19L77 31M92 34L98 26', ORANGE, 3, 2.6),
    dots(GREEN, 2.8, [[78, 38], [60, 22, 2.4]], 1.5),
    rope('M57 41q4-5 8 0t8 0t8 0t8 0t8 0', RED, 2.3, 2.3),
    // the paratha wrap: open rim, char spots, spiral seam
    shape(body, GOLD),
    rope('M54 46A21 7 0 0 0 96 46', CRUST, 4, 3),
    ovals(BROWN, [[66, 58, 3, 1.8], [86, 64, 2.6, 1.6], [70, 76, 2.4, 1.5]]),
    line('M54 66C66 72 82 69 96 57', INK, 2),
    shine('M60 54V78', 3.5),
    // paper wrapper with a pink band
    shape(paper, WHITE, 2.5),
    flat('M51 94L99 108V116L51 102Z', PINK),
    outline(paper),
    '</g>',
  ].join('');
}

/** @type {Record<string, {label: string, group: string, keywords: string[], svg: string}>} */
export default {
  'veg-pizza': {
    label: 'Veg Pizza',
    group: 'mains',
    keywords: ['pizza', 'veg pizza', 'veggie pizza', 'farmhouse', 'capsicum', 'shimla mirch', 'paneer', 'onion', 'cheese', 'italian'],
    svg: vegPizza(),
  },
  'cheese-pizza': {
    label: 'Cheese Pizza',
    group: 'mains',
    keywords: ['pizza', 'cheese pizza', 'margherita', 'cheese burst', 'double cheese', 'pizza slice', 'slice', 'cheesy', 'mozzarella'],
    svg: cheesePizza(),
  },
  burger: {
    label: 'Burger',
    group: 'mains',
    keywords: ['burger', 'veg burger', 'aloo tikki burger', 'tikki', 'paneer burger', 'cheese burger', 'bun', 'patty', 'fast food'],
    svg: burger(),
  },
  'grilled-sandwich': {
    label: 'Grilled Sandwich',
    group: 'mains',
    keywords: [
      'sandwich', 'grilled sandwich', 'bombay sandwich', 'masala toast', 'toast', 'cheese sandwich', 'veg sandwich', 'grill', 'club',
    ],
    svg: grilledSandwich(),
  },
  'steamed-momos': {
    label: 'Steamed Momos',
    group: 'mains',
    keywords: ['momos', 'momo', 'steamed momos', 'veg momos', 'paneer momos', 'dumplings', 'dim sum', 'tibetan'],
    svg: steamedMomos(),
  },
  'fried-momos': {
    label: 'Fried Momos',
    group: 'mains',
    keywords: ['momos', 'momo', 'fried momos', 'kurkure momos', 'tandoori momos', 'crispy', 'dumplings', 'pan fried', 'chutney'],
    svg: friedMomos(),
  },
  maggi: {
    label: 'Masala Noodles',
    group: 'mains',
    keywords: [
      'maggi', 'masala maggi', 'cheese maggi', 'noodles', 'masala noodles', 'instant noodles', 'chowmein', 'hakka noodles', 'bowl',
    ],
    svg: maggi(),
  },
  'pav-bhaji': {
    label: 'Pav Bhaji',
    group: 'mains',
    keywords: ['pav bhaji', 'pav', 'bhaji', 'butter pav', 'bhaji pav', 'masala pav', 'mumbai', 'street food'],
    svg: pavBhaji(),
  },
  'chole-bhature': {
    label: 'Chole Bhature',
    group: 'mains',
    keywords: ['chole bhature', 'chole', 'chhole', 'bhature', 'bhatura', 'chana', 'punjabi', 'chole kulche', 'puri'],
    svg: choleBhature(),
  },
  'frankie-roll': {
    label: 'Frankie Roll',
    group: 'mains',
    keywords: ['frankie', 'roll', 'kathi roll', 'kati roll', 'wrap', 'paneer roll', 'veg roll', 'shawarma'],
    svg: frankieRoll(),
  },
};
