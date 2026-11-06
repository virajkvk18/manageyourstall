// @ts-check
// Illustration batch: desserts (group `sweets`), combo meals (`combos`) and stall games (`games`).
// Drawing contract: ARCHITECTURE.md §7 — Neo-Brutalist food stickers. Each entry's `svg` is inner markup for a
// 150×150 viewBox; library.mjs adds the <svg> wrapper and the soft ground shadow at y≈136.

const INK = '#171717';
const CREAM = '#fff9ed';
const YELLOW = '#ffdd35';
const PINK = '#ff4d87';
const CORAL = '#ff6b5b';
const ORANGE = '#ff9f43';
const MINT = '#7ee0b5';
const LIME = '#b9f36b';
const GREEN = '#42934b';
const LAVENDER = '#c7b6ff';
const SKY = '#8fd3ff';
const CRUST = '#e8a54b';
const GOLD = '#f6b43b';
const BROWN = '#9b633e';
const DARK = '#5a3a22';
const RED = '#eb4235';
const WHITE = '#ffffff';

// ---------------------------------------------------------------------------------------------------------------
// Drawing helpers. Each returns SVG markup; "shapes" arguments are fill-less elements so one outline can be
// reused for the hard shadow and the coloured sticker on top of it.

/** Round to one decimal so generated coordinates stay short. @param {number} v */
const r1 = v => Math.round(v * 10) / 10;

/**
 * Point on a circle as "x y"; `deg` runs clockwise from 3 o'clock (SVG y-down).
 * @param {number} cx @param {number} cy @param {number} r @param {number} deg
 */
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return `${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`;
}

/**
 * Hard offset shadow: `shapes` in solid ink, shifted +4,+4 in screen space (before any `tf` transform).
 * @param {string} shapes @param {number} [width] outline width of the sticker it sits under @param {string} [tf]
 */
const shadow = (shapes, width = 3, tf = '') =>
  `<g transform="translate(4 4)${tf ? ` ${tf}` : ''}" fill="${INK}" stroke="${INK}" ` +
  `stroke-width="${width}" stroke-linejoin="round">${shapes}</g>`;

/**
 * `shapes` painted with one flat fill and an ink outline.
 * @param {string} shapes @param {string} fill @param {number} [width] @param {string} [tf]
 */
const paint = (shapes, fill, width = 3, tf = '') =>
  `<g${tf ? ` transform="${tf}"` : ''} fill="${fill}" stroke="${INK}" stroke-width="${width}" stroke-linejoin="round">${shapes}</g>`;

/**
 * The standard sticker: hard shadow + painted shape.
 * @param {string} shapes @param {string} fill @param {number} [width] @param {string} [tf]
 */
const sticker = (shapes, fill, width = 3, tf = '') => shadow(shapes, width, tf) + paint(shapes, fill, width, tf);

/**
 * Open stroke for details and motion lines.
 * @param {string} d @param {number} [width] @param {string} [color]
 */
const line = (d, width = 2, color = INK) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Cream highlight stroke. @param {string} d @param {number} [width] */
const shine = (d, width = 3.5) => line(d, width, CREAM);

/**
 * Ink-outlined coloured stroke (straws, rings, steam, stands).
 * @param {string} d @param {string} color @param {number} [width] core width
 */
const tube = (d, color, width = 5) => line(d, width + 5) + line(d, width, color);

/** Shapes in a flat fill with no outline (stripes, specks). @param {string} shapes @param {string} fill */
const flat = (shapes, fill) => `<g fill="${fill}">${shapes}</g>`;

/** @param {string} tf @param {string} markup */
const group = (tf, markup) => `<g transform="${tf}">${markup}</g>`;

/**
 * Small rounded bar centred at (x, y), turned `a` degrees (sprinkles, pistachio slivers).
 * @param {number} x @param {number} y @param {number} a @param {number} [w] @param {number} [h]
 */
const sliver = (x, y, a, w = 7, h = 3.5) =>
  `<rect x="${r1(x - w / 2)}" y="${r1(y - h / 2)}" width="${w}" height="${h}" rx="${h / 2}" transform="rotate(${a} ${x} ${y})"/>`;

/**
 * Four-point sparkle.
 * @param {number} x @param {number} y @param {number} [r] @param {string} [fill]
 */
function sparkle(x, y, r = 8, fill = YELLOW) {
  const k = r1(r * 0.22);
  const d = `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
    `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
}

/**
 * Star-burst polygon (fill-less).
 * @param {number} cx @param {number} cy @param {number} rOut @param {number} rIn @param {number} n number of points
 */
function burst(cx, cy, rOut, rIn, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) pts.push(polar(cx, cy, i % 2 ? rIn : rOut, -90 + (180 / n) * i));
  return `<polygon points="${pts.join(' ')}"/>`;
}

/**
 * Ring segment between radii `rIn` < `rOut` from angle `a0` to `a1` (degrees, clockwise); `rIn` 0 = pie slice.
 * @param {number} cx @param {number} cy @param {number} rIn @param {number} rOut @param {number} a0 @param {number} a1
 */
function wedge(cx, cy, rIn, rOut, a0, a1) {
  const outer = `M${polar(cx, cy, rOut, a0)}A${rOut} ${rOut} 0 0 1 ${polar(cx, cy, rOut, a1)}`;
  if (!rIn) return `<path d="${outer}L${cx} ${cy}Z"/>`;
  return `<path d="${outer}L${polar(cx, cy, rIn, a1)}A${rIn} ${rIn} 0 0 0 ${polar(cx, cy, rIn, a0)}Z"/>`;
}

/**
 * Short ink rays around a point (impact / shine marks), from radius `from` out to `to` at each angle.
 * @param {number} cx @param {number} cy @param {number} from @param {number} to @param {number[]} angles
 */
const rays = (cx, cy, from, to, angles) => angles.map(a => `M${polar(cx, cy, from, a)}L${polar(cx, cy, to, a)}`).join('');

// ---------------------------------------------------------------------------------------------------------------
// Sweets

/** Brownie block on a plate: big vanilla scoop, chocolate sauce dripping down, sprinkles, wafer and a cherry. */
function brownieSundae() {
  const plate = '<ellipse cx="75" cy="117" rx="55" ry="13"/>';
  const block = '<path d="M33 86L50 71H114V99L97 114H33Z"/>';
  const scoop = '<path d="M52.8 68A24 24 0 1 1 93.2 68Q97 76 91 79Q85 83 79 79Q73 84 67 79Q61 83 55 79Q49 76 52.8 68Z"/>';
  const sauce = '<path d="M50 48A24 24 0 0 1 96 48Q98 56 94 58Q91 59 90 55Q88 52 85 54V63Q85 67 81.5 67Q78 67 78 63V57' +
    'Q76 54 73 56Q70 58 68 56V61Q68 66 64.5 66Q61 66 61 61V56Q58 53 55 56Q52 59 50 54Z"/>';
  const drips = '<path d="M34 86H96V90Q96 94 92.5 94Q89 94 89 91V90H84V100Q84 105 79.5 105Q75 105 75 100V90' +
    'H59V96Q59 100 55 100Q51 100 51 96V90H42Q38 90 36 93Q34 95 34 91Z"/>';
  const chunks = '<rect x="40" y="103" width="6" height="5" rx="1.5"/><rect x="64" y="104" width="5" height="5" rx="1.5"/>' +
    '<rect x="88" y="107" width="5" height="4" rx="1.5"/><rect x="66" y="93" width="4" height="4" rx="1"/>';
  const sprinkles =
    flat(sliver(62, 42, 30, 6, 2.5) + sliver(87, 46, -40, 6, 2.5), YELLOW) +
    flat(sliver(72, 37, -15, 6, 2.5) + sliver(68, 51, 70, 6, 2.5), MINT) +
    flat(sliver(80, 51, 20, 6, 2.5), SKY) +
    flat(sliver(81, 40, 55, 6, 2.5), PINK);
  const wafer = paint('<rect x="-4.5" y="-36" width="9" height="38" rx="3"/>', GOLD, 2.5) +
    line('M-4 -27l8-5M-4 -18l8-5M-4 -9l8-5', 2, BROWN);
  return [
    sparkle(22, 44, 8),
    sparkle(126, 34, 6, PINK),
    sticker(plate, MINT),
    `<ellipse cx="75" cy="116" rx="41" ry="8" fill="none" stroke="${INK}" stroke-width="2"/>`,
    shine('M27 112Q29 107 40 105', 3),
    shadow(block + scoop),
    group('translate(57 50) rotate(-36)', wafer),
    paint('<path d="M33 86H97V114H33Z"/>', BROWN),
    paint('<path d="M97 86L114 71V99L97 114ZM33 86L50 71H114L97 86Z"/>', DARK),
    paint(chunks, DARK, 1.5),
    paint(drips, DARK, 2),
    shine('M38 81l6-4 5 1M100 77l7-4', 2),
    paint(scoop, WHITE),
    paint(sauce, DARK, 2),
    shine('M56 44Q61 37 69 35', 2.5),
    sprinkles,
    line('M77 25Q79 18 86 15', 2.5),
    `<circle cx="75" cy="31" r="7.5" fill="${RED}" stroke="${INK}" stroke-width="2.5"/>`,
    shine('M71.5 29.5q1-3 4-3.5', 2),
  ].join('');
}

/**
 * One syrupy jamun ball: dark rim, warmer centre, glossy highlight.
 * @param {number} cx @param {number} cy @param {number} r
 */
function jamun(cx, cy, r) {
  const [hx, hy] = polar(cx, cy, r - 5, 268).split(' ');
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${DARK}" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="${cx - 2}" cy="${cy - 2}" r="${r - 4.5}" fill="${BROWN}"/>` +
    shine(`M${polar(cx, cy, r - 5, 185)}A${r - 5} ${r - 5} 0 0 1 ${polar(cx, cy, r - 5, 240)}`, 3) +
    `<circle cx="${+hx + 2}" cy="${hy}" r="1.8" fill="${CREAM}"/>`;
}

/** Steaming bowl of three gulab jamuns sitting in golden chashni, pistachio slivers on top. */
function gulabJamun() {
  const rim = '<ellipse cx="75" cy="84" rx="52" ry="13"/>';
  const body = '<path d="M23 84A52 13 0 0 0 127 84C126 108 103 120 75 120C47 120 24 108 23 84Z"/>';
  const foot = '<path d="M56 112L52 129H98L94 112Z"/>';
  // syrup in front of the balls: wavy waterline across them, down to the bowl's front rim
  const syrup = 'M23 84L36.5 86Q52 96 67.5 86H82.5Q98 96 113.5 86L127 84A52 13 0 0 1 23 84Z';
  const steam = [[52, 50], [75, 44], [98, 50]].map(([x, y]) => tube(`M${x} ${y}q-6-6 0-12t0-12`, CREAM, 3.5)).join('');
  const pista = sliver(71.5, 57, -25) + sliver(81.5, 59, 30) + sliver(48.5, 70, 15) + sliver(95.5, 70, -20);
  return [
    steam,
    shadow(foot + rim + body),
    paint(foot, SKY),
    paint(rim, GOLD),
    jamun(75, 70, 17),
    jamun(52, 82, 16),
    jamun(98, 82, 16),
    `<path d="${syrup}" fill="${GOLD}"/>`,
    line('M36.5 86Q52 96 67.5 86M82.5 86Q98 96 113.5 86', 2),
    shine('M28 87q5 2 9 2M114 89q5-1 8-3', 2.5),
    paint(body, SKY),
    line('M31 99Q44 109 75 110Q106 109 119 99', 4, CREAM),
    shine('M32 93q2 3 6 5', 3),
    paint(pista, LIME, 1.5),
  ].join('');
}

// Kulfi is a cone (wide base, round narrow tip) frozen in a mould; drawn upright on its stick, base at the origin.
const KULFI_BODY = '<path d="M-17 0Q-21 0 -21 -4L-9 -60A9 9 0 0 1 9 -60L21 -4Q21 0 17 0Z"/>';
const KULFI_BITTEN = '<path d="M-17 0Q-21 0 -21 -4L-9 -60A9 9 0 0 1 3.1 -68.5' +
  'A9.5 9.5 0 0 0 10.7 -52A7.5 7.5 0 0 0 13.7 -38L21 -4Q21 0 17 0Z"/>';
const KULFI_STICK = '<rect x="-5" y="-6" width="10" height="34" rx="4"/>';
// Melt drip under the bitten kulfi's base: the fill overlaps the base edge, the outline stays open at the top.
const KULFI_DRIP = 'M-9 -2V2Q-9 9 -12.5 9.5Q-16 9 -16 3V-2Z';
const KULFI_DRIP_EDGE = 'M-9 0.5V2Q-9 9 -12.5 9.5Q-16 9 -16 3V0.5';

/**
 * One stick kulfi, base centre at (x, y).
 * @param {number} x @param {number} y @param {number} rot @param {string} fill @param {string} ridge mould-ridge colour
 * @param {boolean} bitten bitten (and melting) @param {string} bits toppings markup (local coordinates)
 */
function kulfiPop(x, y, rot, fill, ridge, bitten, bits) {
  const tf = `translate(${x} ${y}) rotate(${rot})`;
  const body = bitten ? KULFI_BITTEN : KULFI_BODY;
  const drip = bitten ? `<path d="${KULFI_DRIP}" fill="${fill}"/>${line(KULFI_DRIP_EDGE, 2.5)}` : '';
  return shadow(KULFI_STICK + body + (bitten ? `<path d="${KULFI_DRIP}"/>` : ''), 3, tf) +
    paint(KULFI_STICK, CRUST, 2.5, tf) +
    paint(body, fill, 3, tf) +
    group(tf, drip + line('M-7 -6L-4.5 -44M7 -6L4.5 -44', 2.5, ridge) + bits + shine('M-15 -10L-8 -50'));
}

/** A bitten, melting kesar kulfi in front of a pista kulfi, both studded with pistachio. */
function kulfi() {
  const pista = sliver(-1.5, -33, -25) + sliver(9.5, -20, 20) + sliver(0, -51.5, 35, 6, 3) + sliver(-9, -15.5, -50, 6, 3);
  const kesarBits = paint(pista, GREEN, 1.5) + line('M9 -40l3-4M-1 -12l4-2M-10 -42l3 3', 2, RED);
  const pistaBits = paint(pista, GREEN, 1.5) +
    flat('<circle cx="9" cy="-41" r="1.8"/><circle cx="1" cy="-12" r="1.8"/><circle cx="-9" cy="-44" r="1.6"/>', CREAM);
  return [
    sparkle(26, 30, 8),
    sparkle(127, 74, 6, SKY),
    kulfiPop(92, 96, 16, LIME, GREEN, false, pistaBits),
    kulfiPop(60, 98, -14, YELLOW, ORANGE, true, kesarBits),
  ].join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Combos (shared parts: soda cup, fries carton, pizza slice, combo badge)

const CUP_BODY = '<path d="M-21 -60L-15 -3Q-15 0 -12 0H12Q15 0 15 -3L21 -60Z"/>';
const CUP_LID = '<path d="M-25 -63Q-25 -66 -22 -66H22Q25 -66 25 -63V-59Q25 -56 22 -56H-22Q-25 -56 -25 -59Z"/>';
const CUP_DOME = '<path d="M-19 -66Q-18 -77 0 -78Q18 -77 19 -66Z"/>';

/**
 * Takeaway soda cup with lid and bendy straw, base centre at the origin of `tf`.
 * @param {string} tf @param {string} color @param {string} straw
 */
function sodaCup(tf, color, straw) {
  return shadow(CUP_BODY + CUP_LID + CUP_DOME, 3, tf) +
    group(tf,
      tube('M3 -72L8 -96L15 -100', straw, 5) +
      paint(CUP_BODY, color) +
      flat('<path d="M-12 -56L-9 -3H-4.5L-6.2 -56ZM6.2 -56L4.5 -3H9L12 -56Z"/>', CREAM) +
      paint(CUP_DOME, WHITE) +
      paint(CUP_LID, WHITE));
}

// Fries as [x, top, tilt]: each is a stick from `top` down to y -24 (hidden inside the carton), tilted about its foot.
const FRIES = [[-17, -64, -14], [-10, -75, -7], [-2, -69, -2], [5, -78, 4], [12, -70, 9], [18, -62, 15]];
const CARTON = '<path d="M-27 -52L-19 -3Q-19 0 -16 0H16Q19 0 19 -3L27 -52Q0 -28 -27 -52Z"/>';

/**
 * Fries carton, base centre at the origin of `tf`.
 * @param {string} tf @param {boolean} [small] drop decoration that would be hidden or lost at small scale
 */
function friesCarton(tf, small = false) {
  const fry = ([x, top, a]) =>
    `<rect x="${x - 3.5}" y="${top}" width="7" height="${-24 - top}" rx="1.5" transform="rotate(${a} ${x} -24)"/>`;
  const dots = '<circle cx="0" cy="-22" r="5"/><circle cx="-9" cy="-12" r="2.5"/><circle cx="9" cy="-12" r="2.5"/>';
  return shadow(CARTON, 3, tf) +
    group(tf,
      paint(FRIES.filter((_, i) => i % 2).map(fry).join(''), GOLD, 2) +
      paint(FRIES.filter((_, i) => !(i % 2)).map(fry).join(''), YELLOW, 2) +
      paint(CARTON, RED) +
      shine('M-22 -42L-16.5 -8', 3) +
      (small ? '' : flat(dots, CREAM)));
}

const SLICE_CHEESE = '<path d="M0 0L-29 -62Q0 -74 29 -62Z"/>';
const SLICE_CRUST = '<path d="M-31 -60Q0 -73 31 -60Q36 -67 31 -74Q0 -88 -31 -74Q-36 -67 -31 -60Z"/>';

/**
 * Veg pizza slice, tip at the origin of `tf`, crust pointing to -y.
 * @param {string} tf @param {boolean} [small] drop the finest toppings at small scale
 */
function pizzaSlice(tf, small = false) {
  return shadow(SLICE_CHEESE + SLICE_CRUST, 3, tf) +
    group(tf,
      paint(SLICE_CHEESE, YELLOW) +
      paint(SLICE_CRUST, CRUST) +
      shine('M-20 -77q6-3 12-3M8 -80q6 0 11 2', 3) +
      shine('M-21 -52L-8 -22', 3) +
      paint('<circle cx="-9" cy="-47" r="6.5"/><circle cx="11" cy="-52" r="6"/><circle cx="2" cy="-27" r="5.5"/>', RED, 2) +
      line('M-17 -34q4-5 9-2M7 -38q5 1 5 6M-5 -13q3-4 7-2', 3, GREEN) +
      (small ? '' : line('M16 -42q2 4 0 8M-14 -58q5-2 8 1', 2.5, LAVENDER)));
}

/**
 * Combo starburst badge with a "+" or "%" glyph (drawn with shapes, not text).
 * @param {number} x @param {number} y @param {number} r @param {'plus'|'percent'} glyph
 */
function comboBadge(x, y, r, glyph) {
  const dot = (/** @type {number} */ d) => `<circle cx="${x + d}" cy="${y + d}" r="2.6"/>`;
  const g = glyph === 'plus'
    ? line(`M${x - 6} ${y}H${x + 6}M${x} ${y - 6}V${y + 6}`, 4)
    : `<g fill="none" stroke="${INK}" stroke-width="2.2">${dot(-4.5)}${dot(4.5)}</g>` + line(`M${x + 6} ${y - 7}L${x - 6} ${y + 7}`, 2.5);
  return sticker(burst(x, y, r, r * 0.74, 10), YELLOW, 2.5) + g;
}

/** Fries carton + soda cup side by side, "+" combo badge. */
function comboSnackDrink() {
  return [
    comboBadge(30, 32, 15, 'plus'),
    sodaCup('translate(100 124) rotate(5)', SKY, PINK),
    friesCarton('translate(54 124) rotate(-8)'),
    sparkle(127, 92, 6, PINK),
  ].join('');
}

/** Soda cup + leaning pizza slice, "+" combo badge (mirrored layout so it reads apart from the snack combo). */
function comboPizzaDrink() {
  return [
    comboBadge(116, 31, 15, 'plus'),
    sodaCup('translate(46 124) rotate(-4)', PINK, YELLOW),
    pizzaSlice('translate(66 122) rotate(35) scale(.9)'),
    sparkle(24, 100, 6, SKY),
  ].join('');
}

/** Value meal: fries, pizza slice and soda together on a tray under a "%" deal burst. */
function comboTriple() {
  const trayTop = '<path d="M30 98H120L129 110H21Z"/>';
  const trayFront = '<path d="M21 110H129V117Q129 123 123 123H27Q21 123 21 117Z"/>';
  return [
    shadow(trayTop + trayFront),
    paint(trayTop, YELLOW),
    paint(trayFront, ORANGE),
    sodaCup('translate(104 104) rotate(4) scale(.82)', LAVENDER, PINK),
    friesCarton('translate(49 104) rotate(-4) scale(.78)', true),
    pizzaSlice('translate(40 114) rotate(68) scale(.6)', true),
    comboBadge(27, 28, 14, 'percent'),
  ].join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Games

const BOTTLE = '<path d="M-11 0Q-13 0 -13 -3V-30Q-13 -37 -6 -43V-58H6V-43Q13 -37 13 -30V-3Q13 0 11 0Z"/>' +
  '<rect x="-7.5" y="-64" width="15" height="7" rx="2.5"/>';

/** Glass bottle standing on its base (origin of `tf`). @param {string} tf @param {string} fill */
function bottle(tf, fill) {
  return sticker(BOTTLE, fill, 3, tf) + group(tf, shine('M-8 -28V-8'));
}

/**
 * Elliptical toss ring (full) or only its front half, as an ink-outlined tube.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} rot
 * @param {string} color @param {boolean} [front]
 */
function ring(cx, cy, rx, ry, rot, color, front = false) {
  const d = front
    ? `M${cx - rx} ${cy}A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`
    : `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
  return group(`rotate(${rot} ${cx} ${cy})`, tube(d, color, 5.5));
}

/** Three bottles on a plank: one ringed (ring drawn in two halves around the neck), one ring flying in. */
function ringToss() {
  const plank = '<path d="M20 112H130V121Q130 127 124 127H26Q20 127 20 121Z"/>';
  return [
    sparkle(24, 48, 8),
    sparkle(56, 24, 6, PINK),
    sticker(plank, CRUST),
    line('M30 119H52M64 121H88M100 118H120', 2, BROWN),
    bottle('translate(42 112)', MINT),
    bottle('translate(108 112)', LAVENDER),
    ring(75, 70, 15, 5, -8, PINK),
    bottle('translate(75 112) scale(1.08)', SKY),
    ring(75, 70, 15, 5, -8, PINK, true),
    ring(106, 30, 14, 6, -25, YELLOW),
    line('M120 19l10-5M124 29l10-5M122 39l9-4.5', 3),
  ].join('');
}

/** Eight-colour prize wheel with marquee bulbs, red pointer, stand and spin lines. */
function spinWheel() {
  const cx = 75;
  const cy = 66;
  const colors = [YELLOW, PINK, SKY, ORANGE, MINT, LAVENDER, LIME, CORAL];
  const wedges = colors.map((c, i) => paint(wedge(cx, cy, 0, 35, -112.5 + i * 45, -67.5 + i * 45), c, 2)).join('');
  let bulbs = '';
  for (let i = 0; i < 16; i++) {
    const [x, y] = polar(cx, cy, 39.5, i * 22.5).split(' ');
    bulbs += `<circle cx="${x}" cy="${y}" r="2.4" fill="${i % 2 ? YELLOW : CREAM}"/>`;
  }
  const stand = '<path d="M69 96H81V117H69Z"/><path d="M46 124Q46 117 53 117H97Q104 117 104 124V126Q104 130 100 130H50Q46 130 46 126Z"/>';
  const hub = `<circle cx="${cx}" cy="${cy}" r="8" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="${cx - 2}" cy="${cy - 2}" r="2.2" fill="${CREAM}"/>`;
  return [
    line(`M${polar(cx, cy, 52, 145)}A52 52 0 0 1 ${polar(cx, cy, 52, 195)}`, 3),
    line(`M${polar(cx, cy, 52, 325)}A52 52 0 0 1 ${polar(cx, cy, 52, 375)}`, 3),
    sticker(stand, LAVENDER),
    sticker(`<circle cx="${cx}" cy="${cy}" r="44"/>`, INK),
    wedges,
    bulbs,
    hub,
    sticker('<path d="M75 34L66 18Q75 11 84 18Z"/>', RED),
    `<circle cx="75" cy="18.5" r="2.6" fill="${CREAM}"/>`,
  ].join('');
}

/** Dartboard on an easel (rings, spokes, number dots) with a pink-flighted dart in the bull. */
function dartGame() {
  const cx = 68;
  const cy = 72;
  const rings = [[37, RED], [29, CREAM], [21, RED], [13, CREAM], [7, YELLOW], [3.5, RED]];
  const board = rings.map(([r, c]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`).join('');
  const ringLines = rings.map(([r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
  let spokes = '';
  for (let i = 0; i < 12; i++) spokes += `M${polar(cx, cy, 7, i * 30 + 15)}L${polar(cx, cy, 37, i * 30 + 15)}`;
  let dots = '';
  for (let i = 0; i < 12; i++) {
    const [x, y] = polar(cx, cy, 40.5, i * 30).split(' ');
    dots += `<circle cx="${x}" cy="${y}" r="1.6"/>`;
  }
  const barrel = '<rect x="3" y="-4" width="20" height="8" rx="4"/>';
  const shaft = '<rect x="22" y="-2" width="13" height="4" rx="1"/>';
  const flights = '<path d="M31 0L43 -14H54L47 0L54 14H43Z"/>';
  const tf = `translate(${cx + 3} ${cy - 3}) rotate(-40) scale(1.15)`;
  return [
    sparkle(26, 28, 8),
    sparkle(124, 104, 6, SKY),
    tube('M54 100L44 129M82 100L92 129', BROWN, 5),
    sticker(`<circle cx="${cx}" cy="${cy}" r="44"/>`, DARK),
    board,
    line(spokes, 1.5),
    `<g fill="none" stroke="${INK}" stroke-width="2">${ringLines}</g>`,
    flat(dots, CREAM),
    shadow(barrel + shaft + flights, 2.5, tf),
    paint(shaft, WHITE, 2, tf),
    paint(barrel, SKY, 2.5, tf),
    group(tf, line('M10 -4V4M14 -4V4M18 -4V4', 1.5)),
    paint(flights, PINK, 2.5, tf),
    group(tf, line('M32 0H50', 2)),
    line(rays(cx + 3, cy - 3, 9, 15, [105, 150, 195]), 2.5),
  ].join('');
}

// Upside-down party cup (mouth at the origin, closed base up) for the shell game.
const SHELL_CUP = '<path d="M-15 0L-11 -33Q-10.5 -36 -7.5 -36H7.5Q10.5 -36 11 -33L15 0Q15 2 13 2H-13Q-15 2 -15 0Z"/>';
const SHELL_DOTS = '<circle cx="-5" cy="-24" r="2.6"/><circle cx="5" cy="-15" r="2.6"/>' +
  '<circle cx="6" cy="-29" r="2"/><circle cx="-6" cy="-12" r="2"/>';

/** @param {string} tf @param {boolean} [lifted] show the dark inside of the mouth */
function shellCup(tf, lifted = false) {
  return shadow(SHELL_CUP, 3, tf) +
    group(tf,
      (lifted ? paint('<ellipse cx="0" cy="1" rx="15" ry="4"/>', DARK, 2.5) : '') +
      paint(SHELL_CUP, SKY) +
      line('M-14 -6H14', 2) +
      flat(SHELL_DOTS, CREAM) +
      shine('M-10 -11L-8 -30', 3));
}

/** Shell game: three cups on a felt mat, the middle one lifted off a shining coin, shuffle arrow overhead. */
function luckyCup() {
  return [
    sticker('<ellipse cx="75" cy="122" rx="57" ry="9"/>', LIME),
    line('M26 57L24 66L33 65M124 57L126 66L117 65', 3),
    line('M24 66Q75 8 126 66', 3),
    shellCup('translate(34 120)'),
    shellCup('translate(116 120)'),
    sticker('<circle cx="75" cy="108" r="12"/>', YELLOW, 2.5),
    `<circle cx="75" cy="108" r="7" fill="${GOLD}" stroke="${INK}" stroke-width="1.5"/>`,
    shine('M67.5 104q2-4 6-5.5', 2.2),
    line(rays(75, 108, 16, 22, [200, 160, 340, 20]), 2.5),
    shellCup('translate(75 86) rotate(-12)', true),
    sparkle(126, 28, 7),
    sparkle(22, 30, 6, PINK),
  ].join('');
}

// ---------------------------------------------------------------------------------------------------------------

/** @type {Record<string, {label: string, group: string, keywords: string[], svg: string}>} */
export default {
  'brownie-sundae': {
    label: 'Brownie Sundae',
    group: 'sweets',
    keywords: ['brownie', 'sundae', 'sizzling brownie', 'ice cream', 'chocolate', 'vanilla scoop', 'dessert', 'meetha', 'choco'],
    svg: brownieSundae(),
  },
  'gulab-jamun': {
    label: 'Gulab Jamun',
    group: 'sweets',
    keywords: ['gulab jamun', 'jamun', 'mithai', 'sweet', 'chashni', 'syrup', 'kala jamun', 'meetha', 'dessert'],
    svg: gulabJamun(),
  },
  kulfi: {
    label: 'Kulfi',
    group: 'sweets',
    keywords: ['kulfi', 'malai kulfi', 'matka kulfi', 'kesar pista', 'ice cream', 'stick', 'frozen', 'thanda', 'dessert'],
    svg: kulfi(),
  },
  'combo-snack-drink': {
    label: 'Snack + Drink Combo',
    group: 'combos',
    keywords: ['combo', 'fries', 'chips', 'cold drink', 'soda', 'snack combo', 'meal deal', 'nashta', 'thanda', 'value'],
    svg: comboSnackDrink(),
  },
  'combo-pizza-drink': {
    label: 'Pizza + Drink Combo',
    group: 'combos',
    keywords: ['combo', 'pizza', 'slice', 'cold drink', 'soda', 'pizza combo', 'meal deal', 'thanda', 'value'],
    svg: comboPizzaDrink(),
  },
  'combo-triple': {
    label: 'Value Meal Combo',
    group: 'combos',
    keywords: ['combo', 'value meal', 'triple combo', 'meal', 'pizza', 'fries', 'cold drink', 'party pack', 'deal', 'paisa vasool'],
    svg: comboTriple(),
  },
  'ring-toss': {
    label: 'Ring Toss',
    group: 'games',
    keywords: ['ring toss', 'rings', 'ring game', 'bottle', 'chhalla', 'game', 'carnival', 'mela', 'fest game'],
    svg: ringToss(),
  },
  'spin-wheel': {
    label: 'Spin the Wheel',
    group: 'games',
    keywords: ['spin', 'wheel', 'spin the wheel', 'prize wheel', 'lucky wheel', 'chakri', 'ghumao', 'game', 'mela', 'carnival'],
    svg: spinWheel(),
  },
  'dart-game': {
    label: 'Dart Game',
    group: 'games',
    keywords: ['dart', 'darts', 'dartboard', 'target', 'bullseye', 'nishana', 'balloon dart', 'game', 'mela'],
    svg: dartGame(),
  },
  'lucky-cup': {
    label: 'Lucky Cup',
    group: 'games',
    keywords: ['lucky cup', 'cup game', 'shell game', 'coin', 'guess', 'kismat', 'teen cup', 'game', 'mela'],
    svg: luckyCup(),
  },
};
