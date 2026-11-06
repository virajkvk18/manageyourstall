// @ts-check
// Illustration batch: snacks ("Street & crispy").
// See ARCHITECTURE.md §7 for the drawing contract. Each entry's `svg` is inner markup for a 150×150 viewBox;
// library.mjs adds the <svg> wrapper and the soft ground shadow at y≈136.
// Style: flat palette fills, #171717 ink outlines, a hard +4/+4 offset shadow under the main silhouette,
// cream highlight strokes and a little steam / sparkle. Small string helpers keep the generated markup compact.

const INK = '#171717';
const YELLOW = '#ffdd35';
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

/** Round to one decimal so generated coordinates stay short. @param {number} v */
const r1 = v => Math.round(v * 10) / 10;

/**
 * Hard offset shadow (+4,+4) for a silhouette. Parts are path data ("M…") or fill-less elements ("<ellipse …/>").
 * @param {...string} parts
 */
const shadow = (...parts) =>
  `<g fill="${INK}" transform="translate(4 4)">${parts.map(p => (p.startsWith('<') ? p : `<path d="${p}"/>`)).join('')}</g>`;

/** Ink-outlined filled path. @param {string} d @param {string} fill @param {number} [w] */
const shape = (d, fill, w = 2.5) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

/** Main silhouette: hard shadow + outlined fill. @param {string} d @param {string} fill @param {number} [w] */
const solid = (d, fill, w = 3) => shadow(d) + shape(d, fill, w);

/** Fill-only path for inner shading. @param {string} d @param {string} fill */
const tone = (d, fill) => `<path d="${d}" fill="${fill}"/>`;

/** Open round-capped stroke. @param {string} d @param {string} color @param {number} [w] */
const line = (d, color, w = 2) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Cream highlight stroke. @param {string} d @param {number} [w] */
const shine = (d, w = 3.5) => line(d, CREAM, w);

/**
 * Coloured stroke with an ink casing (sev, drizzles, handles).
 * @param {string} d @param {string} color @param {number} [w]
 */
const cased = (d, color, w = 3) => line(d, INK, w + 3) + line(d, color, w);

/** Rising steam squiggle. @param {string} d */
const steam = d => cased(d, CREAM, 3);

/**
 * Round specks (spice, crumbs, peas) drawn as zero-length round-capped strokes.
 * @param {string} color @param {number} size diameter @param {number[][]} pts
 */
const specks = (color, size, pts) => line(pts.map(([x, y]) => `M${x} ${y}h0`).join(''), color, size);

/**
 * Fill-less ellipse, for shadow lists.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 */
const ell = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;

/**
 * Ink-outlined ellipse, optionally rotated.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {string} fill
 * @param {number} [w] @param {number} [rot]
 */
const oval = (cx, cy, rx, ry, fill, w = 2.5, rot = 0) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width="${w}"` +
  `${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;

/**
 * Small outlined chopped bits (onion, tomato, capsicum…): [x, y, rotation] centres, all one size.
 * @param {string} fill @param {number} s @param {number[][]} pts @param {number} [w]
 */
const bits = (fill, s, pts, w = 1.5) => {
  const rects = pts.map(([x, y, a = 0]) =>
    `<rect x="${r1(x - s / 2)}" y="${r1(y - s / 2)}" width="${s}" height="${s}" rx="1.2" transform="rotate(${a} ${x} ${y})"/>`);
  return `<g fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round">${rects.join('')}</g>`;
};

/** Tiny leaves (coriander, mint): [x, y, rotation]. @param {string} fill @param {number[][]} pts */
const leaves = (fill, pts) => pts.map(([x, y, a]) => oval(x, y, 3.4, 2, fill, 1.2, a)).join('');

/**
 * Four-point twinkle sparkle.
 * @param {number} x @param {number} y @param {number} r @param {string} [fill]
 */
const twinkle = (x, y, r, fill = YELLOW) => {
  const k = r1(r * 0.22);
  const d = `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
    `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
  return shape(d, fill, 2);
};

/**
 * Liquid drop pointing up.
 * @param {number} x @param {number} y @param {number} s @param {string} fill
 */
const drop = (x, y, s, fill) => {
  const tip = r1(y - 1.8 * s);
  return shape(`M${x} ${tip}Q${r1(x + 1.3 * s)} ${y} ${x} ${r1(y + s)}Q${r1(x - 1.3 * s)} ${y} ${x} ${tip}Z`, fill, 1.5);
};

/**
 * Ink-cased ring (onion slice).
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {string} color
 */
const ring = (cx, cy, rx, ry, color) => {
  const e = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke=`;
  return `${e}"${INK}" stroke-width="5.5"/>${e}"${color}" stroke-width="2.5"/>`;
};

/**
 * Star polygon path.
 * @param {number} cx @param {number} cy @param {number} R outer radius @param {number} r inner radius @param {number} n points
 */
function starPath(cx, cy, R, r, n) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = ((-90 + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 ? r : R;
    d += `${i ? 'L' : 'M'}${r1(cx + rad * Math.cos(a))} ${r1(cy + rad * Math.sin(a))}`;
  }
  return d + 'Z';
}

/**
 * Ellipse with a scalloped (leaf-plate) rim.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} n scallops @param {number} bump
 */
function scallopOval(cx, cy, rx, ry, n, bump) {
  let d = `M${cx + rx} ${cy}`;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const m = ((i - 0.5) / n) * 2 * Math.PI;
    d += `Q${r1(cx + rx * bump * Math.cos(m))} ${r1(cy + ry * bump * Math.sin(m))}` +
      ` ${r1(cx + rx * Math.cos(a))} ${r1(cy + ry * Math.sin(a))}`;
  }
  return d + 'Z';
}

/**
 * A point on a quadratic Bézier.
 * @param {number[]} p0 @param {number[]} p1 @param {number[]} p2 @param {number} t
 */
const quadAt = (p0, p1, p2, t) => [0, 1].map(i => r1((1 - t) ** 2 * p0[i] + 2 * (1 - t) * t * p1[i] + t * t * p2[i]));

/**
 * Rotate point (x, y) by `deg` degrees around (cx, cy).
 * @param {number} x @param {number} y @param {number} cx @param {number} cy @param {number} deg
 */
const turn = (x, y, cx, cy, deg) => {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [r1(cx + (x - cx) * c - (y - cy) * s), r1(cy + (x - cx) * s + (y - cy) * c)];
};

/**
 * A row of fries standing in a container: shadow parts, outlined sticks and a side shade, as markup strings.
 * Each fry is [x, topY, tiltDegrees]; all pivot around y = base.
 * @param {number[][]} fries @param {number} base @param {string} fill @param {string} shade
 */
function fryRow(fries, base, fill, shade) {
  const rect = (/** @type {number[]} */ [x, top, a], dx = -4.5, w = 9, inset = 0) =>
    `<rect x="${x + dx}" y="${top + inset}" width="${w}" height="${base - top - 2 * inset}"` +
    `${inset ? '' : ' rx="2.5"'} transform="rotate(${a} ${x} ${base})"/>`;
  return {
    shadow: fries.map(f => rect(f)),
    body: `<g fill="${fill}" stroke="${INK}" stroke-width="2.5">${fries.map(f => rect(f)).join('')}</g>` +
      `<g fill="${shade}">${fries.map(f => rect(f, 0.6, 2.6, 2)).join('')}</g>`,
  };
}

// ---------------------------------------------------------------------------------------------------------------

/** Two crisp samosas (the back one bitten to show potato + peas), green chutney katori, steam. */
function samosa() {
  // Back samosa: bite out of its right shoulder (three tooth scallops), filling crescent inside the bite.
  const teethUp = 'L116.2 69A6.6 6.6 0 0 1 105.3 64.6A6.6 6.6 0 0 1 101 53.6A6.6 6.6 0 0 1 105.9 42.9';
  const teethDown = 'A6.6 6.6 0 0 0 101 53.6A6.6 6.6 0 0 0 105.3 64.6A6.6 6.6 0 0 0 116.2 69';
  const back = `M96 32L73 102Q70 110 78 113L99 120Q102 121 105 120L126 109Q132 105 129 99${teethUp}L103 32Q100 25 96 32Z`;
  const backSide = `M99.5 29Q100 76 102 120L126 109Q132 105 129 99${teethUp}L103 32Q101.5 28.5 99.5 29Z`;
  const filling = `M105.9 42.9${teethDown}C96 78 78 50 105.9 42.9Z`;
  const front = 'M56 24Q30 58 19 104Q16 113 25 116L56 127Q61 129 66 127L96 118Q104 115 101 107Q86 60 62 25Q59 20 56 24Z';
  const frontSide = 'M59 26Q63 80 61 127L96 118Q104 115 101 107Q86 60 62 25Z';
  let crimp = '';
  for (let i = 1; i < 8; i++) {
    const [x, y] = quadAt([59, 26], [63, 80], [61, 127], i / 8.4);
    crimp += `M${r1(x - 4)} ${r1(y - 2)}l8 3`;
  }
  return [
    '<g transform="translate(-4 0) rotate(7 102 118)">',
    solid(back, GOLD),
    shape(backSide, CRUST, 2),
    shape(filling, YELLOW, 2),
    specks(GREEN, 4.6, [[94, 53], [96, 62], [104, 68]]),
    specks(BROWN, 3, [[86, 92], [112, 96], [118, 82]]),
    '</g>',
    solid(front, GOLD),
    shape(frontSide, CRUST, 2),
    line(crimp, INK, 2),
    specks(BROWN, 3.4, [[34, 98], [44, 80], [50, 106], [72, 82], [83, 100], [75, 114]]),
    shine('M28 102Q34 74 50 44', 4),
    solid('M96 119Q98 133 114 133Q130 133 132 119Z', WHITE),
    oval(114, 119, 18, 5.5, GREEN),
    line('M106 119q4-3 8 0t8 0', MINT, 2.5),
    steam('M121 46q-4-4 0-8t0-8'),
    steam('M131 54q-3-3 0-6t0-6'),
    twinkle(26, 32, 8),
    twinkle(88, 22, 5),
  ].join('');
}

/** Two puffed khasta kachoris on a leaf plate; the front one cracked open to show the spicy dal filling. */
function kachori() {
  const plate = scallopOval(75, 114, 53, 16, 22, 1.13);
  // lumpy, blistered outlines read as flaky fried dough rather than smooth buns
  const back = 'M64 93C62 84 68 77 76 74C80 68 88 66 95 67C101 64 110 65 115 69C123 71 129 79 128 88' +
    'C128 100 114 106 96 106C80 106 66 102 64 93Z';
  const backTop = 'M69 89C69 82 74 78 80 77C84 72 90 71 96 72C101 69 108 70 112 73C118 75 123 80 123 86C112 93 80 95 69 89Z';
  const front = 'M20 104C18 93 24 85 33 82C37 77 46 75 53 77C59 74 68 74 74 78C84 79 93 86 95 96' +
    'C98 107 92 116 80 118C70 121 46 121 36 119C25 117 19 112 20 104Z';
  const frontTop = 'M25 99C25 92 30 87 37 86C41 81 48 80 54 82C60 79 67 79 72 82C80 83 88 88 90 96C80 103 38 104 25 99Z';
  const crack = 'M38 90l7-7 5 4 6-6 6 5 7-5 5 5 6 2-6 6-12 3-13-1Z';
  const blisters = (/** @type {number[][]} */ pts) => {
    const dots = pts.map(([x, y, r = 2.4]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`);
    return `<g fill="${YELLOW}" stroke="${CRUST}" stroke-width="1.4">${dots.join('')}</g>`;
  };
  return [
    solid(plate, GREEN),
    `<ellipse cx="75" cy="114" rx="44" ry="11" fill="none" stroke="${LIME}" stroke-width="2" stroke-dasharray="5 4"/>`,
    solid(back, CRUST),
    tone(backTop, GOLD),
    blisters([[80, 80], [110, 76], [117, 86], [86, 96, 2], [104, 99, 2], [97, 84, 2]]),
    line('M93 72q4-3 8 0q-2 3-5 1M120 94q-3 4-8 5M70 96q3 3 7 4', BROWN, 2),
    shine('M71 86Q73 77 82 74'),
    solid(front, CRUST),
    tone(frontTop, GOLD),
    blisters([[30, 100], [41, 110, 2], [78, 110, 2], [87, 100], [58, 108, 2]]),
    line('M27 109q4 4 9 5M89 107q-2 5-7 7', BROWN, 2),
    shape(crack, DARK, 2),
    specks(BROWN, 3.4, [[47, 91], [58, 89], [67, 92]]),
    specks(GREEN, 2.6, [[52, 94], [72, 89]]),
    specks(ORANGE, 2.6, [[62, 94], [44, 89]]),
    shine('M25 104Q25 94 32 88'),
    ring(108, 121, 8, 4, LAVENDER),
    ring(119, 117, 7, 3.5, LAVENDER),
    steam('M50 76q-5-5 0-10t0-10'),
    steam('M64 74q-4-4 0-8t0-8'),
    twinkle(116, 40, 8),
    twinkle(30, 54, 5),
  ].join('');
}

/** Pani puri: crisp hollow puris filled with green pani on a plate, one lifted and dripping over the pani bowl. */
function paniPuri() {
  const puris = [[33, 88], [60, 86], [87, 89], [46, 104], [73, 105]];
  const puri = (/** @type {number[]} */ [x, y], r = 15) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${GOLD}" stroke="${INK}" stroke-width="2.5"/>` +
    shine(`M${x - r * 0.7} ${y + 2}q0-${r * 0.5} ${r * 0.4}-${r * 0.75}`, 3) +
    oval(x, r1(y - r * 0.45), r1(r * 0.45), r1(r * 0.2), DARK, 1.8) +
    `<ellipse cx="${x}" cy="${r1(y - r * 0.42)}" rx="${r1(r * 0.3)}" ry="${r1(r * 0.12)}" fill="${MINT}"/>`;
  return [
    shadow(ell(62, 114, 42, 14)),
    oval(62, 114, 42, 14, WHITE, 3),
    shadow(...puris.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15"/>`)),
    puris.map(p => puri(p)).join(''),
    specks(YELLOW, 2.6, puris.map(([x, y]) => [x + 3, y - 7.5])),
    solid('M90 98Q92 130 111 130Q130 130 132 98Z', SKY),
    oval(111, 98, 21, 6.5, MINT),
    `<ellipse cx="111" cy="98.5" rx="8" ry="2.2" fill="none" stroke="${CREAM}" stroke-width="1.8"/>`,
    leaves(GREEN, [[99, 99, -20], [123, 98, 25]]),
    shine('M95 104q2 13 12 17', 3),
    shadow('<circle cx="110" cy="58" r="12"/>'),
    puri([110, 58], 12),
    drop(110, 78, 2.6, MINT),
    drop(111, 88, 2, MINT),
    twinkle(26, 44, 8),
    twinkle(46, 26, 4.5),
    twinkle(80, 40, 5),
  ].join('');
}

/** Bhel puri heaped in a newspaper cone, papdi stuck in like a spoon. */
function bhelPuri() {
  const cone = 'M34 66Q52 100 67 129Q71 135 75 129Q94 98 112 63Q73 84 34 66Z';
  const heap = 'M33 67C26 56 34 46 45 48C45 36 59 30 68 37C73 27 89 27 93 37C103 32 115 41 109 52C117 57 115 64 112 64Q73 84 33 67Z';
  const grains = [
    [42, 56, 20], [50, 47, -30], [61, 41, 10], [73, 36, -15], [85, 35, 25], [96, 42, -20], [105, 51, 15], [107, 60, -10],
    [54, 58, 30], [66, 50, -5], [79, 46, 20], [91, 53, -25], [99, 61, 10], [46, 65, 0], [70, 61, 15], [84, 63, -15],
  ];
  const puffs = grains.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="2.4" transform="rotate(${a} ${x} ${y})"/>`);
  return [
    '<g transform="rotate(-7 72 80)">',
    shape('M40 64L28 30L64 50Z', WHITE, 2.5),
    oval(101, 30, 14, 9, GOLD, 2.5, -30),
    specks(DARK, 3, [[96, 31], [101, 27], [106, 31]]),
    solid(heap, CRUST),
    `<g fill="${CREAM}" stroke="${INK}" stroke-width="1.2">${puffs.join('')}</g>`,
    cased('M47 52q3-3 6 0t6 0M74 42q3-3 6 0t6 0M88 58q3-3 6 0t6 0M58 64q3-3 6 0t6 0M98 47q2-3 5 0', YELLOW, 2),
    bits(RED, 5, [[60, 47, 20], [93, 47, -15], [77, 56, 40]]),
    bits(LAVENDER, 4.5, [[51, 59, -10], [86, 41, 30], [103, 56, 10]]),
    leaves(GREEN, [[68, 44, -30], [82, 52, 25], [43, 61, 10]]),
    solid(cone, WHITE),
    `<path d="M50 86h40M55 97h32M60 108h22M65 118h12" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="6 3"/>`,
    shine('M41 76Q51 96 62 116', 3),
    '</g>',
    twinkle(122, 82, 7),
    twinkle(24, 92, 5),
  ].join('');
}

/** Golden aloo tikki patties on a paper plate with curd, green chutney, saunth and pomegranate. */
function alooTikki() {
  /**
   * A thick patty: crisp side band (shadowed) under a golden top.
   * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
   */
  const patty = (cx, cy, rx, ry) =>
    solid(`M${cx - rx} ${cy}a${rx} ${ry} 0 0 1 ${2 * rx} 0v11a${rx} ${ry} 0 0 1 ${-2 * rx} 0Z`, CRUST) + oval(cx, cy, rx, ry, GOLD);
  let ridges = '';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * 2 * Math.PI;
    ridges += `M${r1(75 + 45 * Math.cos(a))} ${r1(102 + 20 * Math.sin(a))}L${r1(75 + 54 * Math.cos(a))} ${r1(104 + 25 * Math.sin(a))}`;
  }
  const seeds = [[44, 85], [62, 84], [78, 91], [50, 109], [68, 109], [30, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`);
  return [
    shadow(ell(75, 104, 56, 27)),
    oval(75, 104, 56, 27, CORAL, 3),
    line(ridges, INK, 1.5),
    oval(75, 102, 45, 20, CREAM, 2),
    patty(92, 80, 30, 15),
    specks(BROWN, 3.6, [[76, 78], [97, 71], [111, 80], [101, 88], [84, 88], [114, 72]]),
    shine('M68 78q6-7 18-9', 3),
    cased('M86 80l5-4 5 4 5-4 5 4 5-4 5 4', BROWN, 2.5),
    patty(57, 96, 32, 16),
    specks(BROWN, 3.6, [[33, 98], [81, 97], [58, 108], [42, 105], [71, 104]]),
    cased('M33 92l6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5', WHITE, 3),
    cased('M37 102l6-4 6 4 6-4 6 4 6-4 6 4 6-4', GREEN, 2.4),
    `<g fill="${RED}" stroke="${INK}" stroke-width="1">${seeds.join('')}</g>`,
    leaves(GREEN, [[56, 92, 20], [84, 99, -30]]),
    steam('M86 60q-5-5 0-10t0-10'),
    steam('M100 58q-4-4 0-8t0-8'),
    twinkle(28, 50, 8),
    twinkle(44, 30, 4.5),
    twinkle(124, 48, 5),
  ].join('');
}

/** Crispy fried corn kernels heaped in a striped bowl with a corn cob behind. */
function crispyCorn() {
  let grid = '';
  for (let y = 24; y < 68; y += 6) {
    const h = r1(12 * Math.sqrt(1 - ((y - 44) / 26) ** 2));
    grid += `M${r1(40 - h)} ${y}H${r1(40 + h)}`;
  }
  grid += 'M40 18V70M34 19.5A6 25 0 0 0 34 68.5M46 19.5A6 25 0 0 1 46 68.5';
  const bowl = 'M30 76C31 108 48 127 75 127C102 127 119 108 120 76Z';
  const heap = 'M30 78C26 64 38 54 50 56C54 44 70 42 78 48C88 40 104 46 106 56C118 56 124 68 120 78Q75 98 30 78Z';
  const kernels = [
    [52, 56], [63, 52], [75, 54], [87, 50], [97, 56],
    [40, 64], [50, 65], [61, 62], [71, 63], [81, 61], [92, 64], [102, 63], [112, 66],
    [36, 72], [46, 73], [56, 71], [66, 72], [76, 71], [86, 72], [96, 71], [106, 72], [115, 74],
    [52, 80], [62, 80], [72, 81], [82, 80], [92, 80],
  ];
  const rect = (/** @type {number[]} */ [x, y]) => `<rect x="${x - 3.5}" y="${y - 3}" width="7" height="6" rx="2"/>`;
  const kernelGroup = (/** @type {string} */ fill, /** @type {number} */ odd) =>
    `<g fill="${fill}" stroke="${INK}" stroke-width="1.5">${kernels.filter((_, i) => i % 2 === odd).map(rect).join('')}</g>`;
  return [
    '<g transform="rotate(-24 40 44)">',
    shape('M38 74Q18 66 22 36Q30 58 40 62Z', GREEN, 2.5),
    oval(40, 44, 12, 26, YELLOW),
    line(grid, INK, 1.3),
    shape('M42 74Q62 66 60 40Q52 58 40 62Z', GREEN, 2.5),
    line('M44 70Q54 62 56 48', LIME, 2),
    '</g>',
    solid(bowl, CORAL),
    shine('M37 98Q50 106 62 99T87 99T113 97', 4),
    shine('M45 114Q58 121 75 120T106 113', 4),
    solid(heap, GOLD),
    kernelGroup(YELLOW, 1),
    kernelGroup(ORANGE, 0),
    bits(GREEN, 4.5, [[57, 58, 20], [89, 57, -30], [101, 69, 15], [44, 70, 40]]),
    bits(RED, 3.5, [[68, 58, 10], [80, 66, 45], [60, 76, -20], [108, 68, 30]]),
    `<g fill="none" stroke="${GREEN}" stroke-width="2">` +
      '<circle cx="74" cy="47" r="2.6"/><circle cx="96" cy="76" r="2.6"/><circle cx="40" cy="78" r="2.6"/></g>',
    shape('M29 76Q75 96 121 76Q75 106 29 76Z', CORAL, 2.5),
    twinkle(118, 34, 8),
    twinkle(104, 21, 4.5),
  ].join('');
}

/** Classic salted fries standing tall in a red carton, ketchup dip on the side. */
function frenchFries() {
  const fries = fryRow([
    [52, 32, -12], [64, 22, -6], [76, 18, 0], [88, 24, 7], [100, 34, 14],
    [46, 46, -16], [58, 40, -8], [70, 34, -2], [82, 36, 4], [94, 44, 10],
  ], 90, YELLOW, GOLD);
  const back = 'M36 66L40 50Q75 42 110 50L114 66Z';
  const front = 'M36 66Q75 84 114 66L104 128Q75 133 46 128Z';
  return [
    shadow(back, ...fries.shadow, front),
    shape(back, CORAL, 3),
    fries.body,
    shape(front, RED, 3),
    shine('M44 78L51 120', 4),
    shape(starPath(76, 103, 14, 6.5, 5), YELLOW, 2),
    shape('M106 116L108 128Q117 131 126 128L128 116Z', WHITE, 2.5),
    oval(117, 116, 11, 3.5, RED),
    twinkle(28, 40, 8),
    twinkle(122, 46, 6),
  ].join('');
}

/** Peri-peri fries: red-dusted fries in a flame-printed cup, masala sachet sprinkling, a chilli on the side. */
function periPeriFries() {
  const BASE = 86;
  const list = [
    [44, 38, -22], [56, 28, -13], [68, 22, -5], [80, 24, 4], [92, 32, 12], [100, 42, 20],
    [60, 42, -9], [74, 38, -1], [86, 44, 8],
  ];
  const fries = fryRow(list, BASE, ORANGE, CORAL);
  // masala dust on the sticks, rotated into place so one path carries every speck
  const dust = list.flatMap(([x, top, a]) =>
    [[x - 1.5, top + 6], [x + 1, top + 13], [x - 2, top + 20], [x + 1.5, top + 28]].map(([px, py]) => turn(px, py, x, BASE, a)));
  const cup = 'M34 66A36 8 0 0 0 106 66L94 126Q70 132 46 126Z';
  const flames = 'M44.5 117C46 110 50 106 50 98C54 104 58 106 59 110C60 102 64 96 68 90C70 98 74 102 76 108' +
    'C78 102 82 98 86 95C88 102 92 106 96 112L94 126Q70 132 46 126Z';
  const innerFlames = 'M51 124C50 118 53 113 54 107C57 112 60 115 62 119C63 111 66 105 68 100C70 107 73 112 75 118' +
    'C77 112 80 108 84 105C85 112 87 117 88 124Q70 128 51 124Z';
  const chilli = 'M100 129C113 126 124 112 126 94C127 88 121 87 119 92C116 107 108 117 97 121C92 123 94 130 100 129Z';
  let sachet = 'M104 20';
  for (let i = 0; i < 4; i++) sachet += 'l2.5-3 2.5 3';
  sachet += 'V42';
  for (let i = 0; i < 4; i++) sachet += 'l-2.5 3-2.5-3';
  sachet += 'Z';
  return [
    shadow(...fries.shadow, cup, chilli),
    oval(70, 66, 36, 8, CRUST, 3),
    fries.body,
    specks(RED, 3.2, dust),
    shape(cup, YELLOW, 3),
    shape(flames, RED, 2),
    shape(innerFlames, ORANGE, 1.5),
    shine('M41 76L48 104', 4),
    shape(chilli, RED, 2.5),
    shape('M119 92C116 86 120 80 126 82C131 84 130 91 126 93Z', GREEN, 2),
    line('M125 82q1-5 5-7', INK, 2.5),
    shine('M104 123Q115 115 120 99', 2.5),
    '<g transform="translate(-1 3) rotate(35 114 31)">',
    shape(sachet, RED, 2.5),
    shape('M111 27q3-3 6 0q1 6-3 10q-4-4-3-10Z', CREAM, 1.2),
    '</g>',
    specks(RED, 4, [[98, 40], [92, 46], [86, 38], [80, 46], [74, 34], [66, 40], [60, 30], [52, 36], [90, 30]]),
    specks(ORANGE, 3.2, [[95, 34], [84, 44], [70, 30], [56, 42]]),
    twinkle(24, 52, 6),
  ].join('');
}

/** Loaded nachos: tortilla chips piled on a tray with melted cheese, jalapeños and salsa. */
function nachos() {
  const chips = [
    [46, 62, 23, 8], [76, 50, 25, -6], [104, 62, 23, 22], [58, 80, 22, 46], [92, 78, 23, -28],
    [38, 90, 19, 14], [112, 90, 19, -16], [72, 96, 21, 98], [100, 100, 20, 66], [48, 102, 20, -38],
  ];
  const tri = (/** @type {number[]} */ [cx, cy, s, a]) =>
    [0, 120, 240]
      .map((k, i) => {
        const t = ((a - 90 + k) * Math.PI) / 180;
        return `${i ? 'L' : 'M'}${r1(cx + s * Math.cos(t))} ${r1(cy + s * Math.sin(t))}`;
      })
      .join('') + 'Z';
  const tray = 'M19 104Q22 130 75 130Q128 130 131 104Z';
  const cheese = 'M40 72C52 62 66 70 76 64C88 58 100 66 108 72C112 80 104 82 102 88C100 96 96 96 96 88C94 82 86 84 82 90' +
    'C80 102 74 102 74 92C74 84 64 84 60 88C58 94 52 94 52 88C52 82 44 80 40 72Z';
  const jalapeno = (/** @type {number[]} */ [x, y]) =>
    oval(x, y, 5.5, 5.5, GREEN, 2) + `<circle cx="${x}" cy="${y}" r="2.8" fill="${LIME}"/>`;
  return [
    shadow(tray, ...chips.map(tri)),
    shape(tray, LAVENDER, 3),
    oval(75, 104, 56, 12, LAVENDER, 3),
    chips.map(c => shape(tri(c), GOLD, 2.5)).join(''),
    specks(CRUST, 3.2, chips.flatMap(([x, y]) => [[x - 4, y + 3], [x + 4, y - 2]])),
    shape(cheese, YELLOW, 2.5),
    shine('M48 72q10-4 18 0M84 66q8-3 16 2', 3),
    [[62, 72], [92, 70], [78, 82], [106, 80]].map(jalapeno).join(''),
    bits(RED, 5, [[50, 78, 15], [70, 66, -20], [98, 88, 30], [86, 76, 10]]),
    twinkle(26, 38, 7),
    twinkle(124, 36, 6),
  ].join('');
}

/** Packet chaat: an opened chips packet heaped with chips, onion, tomato, sev and coriander, spoon stuck in. */
function chipsPacket() {
  let zig = '';
  for (let i = 0; i < 10; i++) zig += 'l4 5 4-5';
  const bag = `M36 56C29 78 29 100 35 120V126${zig}L115 120C121 100 121 78 114 56Z`;
  const heap = 'M36 56A39 8 0 0 0 114 56C120 50 116 42 108 42C104 34 92 32 84 38C76 32 62 32 56 40C46 38 32 46 36 56Z';
  // irregular wavy chips (with ridges and masala specks) poking out of the packet, placed by translate + rotate
  const at = [[50, 38, -35], [69, 30, -10], [89, 31, 15], [106, 40, 40]];
  const placed = (/** @type {string} */ d) =>
    at.map(([x, y, a]) => `<path transform="translate(${x} ${y}) rotate(${a})" d="${d}"/>`).join('');
  const chips =
    `<g fill="${YELLOW}" stroke="${INK}" stroke-width="2" stroke-linejoin="round">` +
    `${placed('M-12 1C-12-6-4-10 2-9C9-9 13-3 12 2C11 8 4 10-2 9C-9 9-12 6-12 1Z')}</g>` +
    `<g fill="none" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round">${placed('M-8 0q3-3 6 0t6 0t5 0')}</g>` +
    `<g stroke="${CRUST}" stroke-width="2.6" stroke-linecap="round">${placed('M-4 4h0M5-4h0')}</g>`;
  return [
    '<g transform="translate(0 -3) rotate(-6 75 80)">',
    solid(bag, SKY),
    line('M35 120H115', INK, 2),
    shape(starPath(75, 92, 21, 15, 12), YELLOW, 2),
    oval(75, 92, 11, 7.5, GOLD, 2, -15),
    line('M67 92q4-3 8 0t8 0', CRUST, 2),
    shine('M41 66Q36 90 41 112', 4),
    oval(75, 56, 39, 8, WHITE, 3),
    cased('M92 46L117 26', WHITE, 4),
    chips,
    shape(heap, CRUST, 2.5),
    bits(LAVENDER, 5, [[50, 50, 15], [86, 44, -20], [104, 50, 30]]),
    bits(RED, 5, [[64, 44, -10], [96, 54, 20], [74, 54, 40]]),
    cased('M56 54q3-3 6 0t6 0M78 46q3-3 6 0t6 0M40 50q3-3 6 0', YELLOW, 1.8),
    leaves(GREEN, [[70, 40, -30], [88, 58, 20], [45, 45, 40], [110, 46, -10]]),
    '</g>',
    twinkle(26, 30, 7),
    twinkle(128, 64, 5),
  ].join('');
}

/**
 * Snacks batch for the visual library (ARCHITECTURE.md §7): id → { label, group, keywords, svg }.
 * @type {Record<string, {label: string, group: string, keywords: string[], svg: string}>}
 */
export default {
  samosa: {
    label: 'Samosa',
    group: 'snacks',
    keywords: ['samosa', 'samose', 'singhara', 'aloo samosa', 'chai snack', 'fried', 'chutney', 'triangle'],
    svg: samosa(),
  },
  kachori: {
    label: 'Kachori',
    group: 'snacks',
    keywords: ['kachori', 'kachauri', 'khasta kachori', 'pyaz kachori', 'raj kachori', 'dal kachori', 'fried', 'chaat'],
    svg: kachori(),
  },
  'pani-puri': {
    label: 'Pani Puri',
    group: 'snacks',
    keywords: ['pani puri', 'golgappa', 'gol gappe', 'puchka', 'phuchka', 'pani patashe', 'gupchup', 'chaat'],
    svg: paniPuri(),
  },
  'bhel-puri': {
    label: 'Bhel Puri',
    group: 'snacks',
    keywords: ['bhel puri', 'bhel', 'jhalmuri', 'murmura', 'chaat', 'sev', 'paper cone', 'mumbai'],
    svg: bhelPuri(),
  },
  'aloo-tikki': {
    label: 'Aloo Tikki',
    group: 'snacks',
    keywords: ['aloo tikki', 'tikki', 'tikki chaat', 'ragda pattice', 'potato patty', 'cutlet', 'chaat', 'chole tikki'],
    svg: alooTikki(),
  },
  'crispy-corn': {
    label: 'Crispy Corn',
    group: 'snacks',
    keywords: ['crispy corn', 'corn', 'makka', 'makai', 'bhutta', 'sweet corn', 'chilli corn', 'starter'],
    svg: crispyCorn(),
  },
  'french-fries': {
    label: 'French Fries',
    group: 'snacks',
    keywords: ['french fries', 'fries', 'finger chips', 'chips', 'salted fries', 'potato', 'aloo', 'ketchup'],
    svg: frenchFries(),
  },
  'peri-peri-fries': {
    label: 'Peri Peri Fries',
    group: 'snacks',
    keywords: ['peri peri fries', 'peri peri', 'piri piri', 'masala fries', 'spicy fries', 'fries', 'chilli', 'teekha'],
    svg: periPeriFries(),
  },
  nachos: {
    label: 'Nachos',
    group: 'snacks',
    keywords: ['nachos', 'cheese nachos', 'loaded nachos', 'tortilla chips', 'salsa', 'jalapeno', 'cheese dip', 'mexican'],
    svg: nachos(),
  },
  'chips-packet': {
    label: 'Chips Packet Chaat',
    group: 'snacks',
    keywords: ['chips packet', 'packet chaat', 'chips chaat', 'wafers', 'namkeen', 'masala chips', 'chatpata', 'crisps'],
    svg: chipsPacket(),
  },
};
