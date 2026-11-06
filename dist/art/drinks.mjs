// @ts-check
// Illustration batch: drinks (chai, coffee, fizz, coolers, shakes, lassi).
// See ARCHITECTURE.md §7 for the drawing contract. Each `svg` is inner markup for a 150×150 viewBox;
// library.mjs adds the <svg> wrapper and the soft ground shadow at y≈136.

const INK = '#171717';
const CREAM = '#fff9ed';
const WHITE = '#ffffff';
const YELLOW = '#ffdd35';
const PINK = '#ff4d87';
const ORANGE = '#ff9f43';
const MINT = '#7ee0b5';
const LIME = '#b9f36b';
const GREEN = '#42934b';
const SKY = '#8fd3ff';
const CRUST = '#e8a54b';
const GOLD = '#f6b43b';
const BROWN = '#9b633e';
const DARK = '#5a3a22';
const RED = '#eb4235';
/** Fired-clay terracotta for the kulhad: the one earthy tone the base palette lacks. */
const CLAY = '#c8643b';
/** Design-system `--yellow-soft`, used for the kesar-tinted lassi. */
const SOFT_YELLOW = '#fff1bf';

/** Round to one decimal for compact path data. @param {number} v */
const n = v => Math.round(v * 10) / 10;

/** Ink outline attributes. @param {number} [w] stroke width */
const ink = (w = 3) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Hard offset shadow (+4,+4) of a silhouette path. @param {string} d */
const shadow = d => `<path d="${d}" fill="${INK}" transform="translate(4 4)"/>`;

/** Ink-outlined cream steam ribbon. @param {string} d */
const steam = d =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${CREAM}" stroke-width="3.5" stroke-linecap="round"/>`;

/**
 * Four-point sparkle star.
 * @param {number} x @param {number} y @param {number} r @param {string} [fill]
 */
function sparkle(x, y, r, fill = YELLOW) {
  const k = n(r * 0.22);
  const d = `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
    `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
  return `<path d="${d}" fill="${fill}" ${ink(2)}/>`;
}

/** Outlined white bubbles. @param {number[][]} list [x, y, r][] @param {number} [w] */
const bubbles = (list, w = 1.5) =>
  list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${WHITE}" stroke="${INK}" stroke-width="${w}"/>`).join('');

/** Plain filled dots (speckles, biscuit holes). @param {number[][]} list [x, y][] @param {number} r @param {string} fill */
const dots = (list, r, fill) => `<g fill="${fill}">${list.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;

/** Small outlined water droplet (condensation). @param {number} x @param {number} y */
const drop = (x, y) => `<path d="M${x} ${y}q3.5 5 0 7.5q-3.5-2.5 0-7.5Z" fill="${WHITE}" ${ink(1.5)}/>`;

/**
 * Striped drinking straw with rounded ends.
 * @param {string} d path data @param {string} color @param {string} [stripe]
 */
const straw = (d, color, stripe = WHITE) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${stripe}" stroke-width="5" stroke-dasharray="4 5"/>`;

/**
 * Citrus wheel: rind, cream pith ring, flesh and cream segment spokes.
 * @param {number} cx @param {number} cy @param {number} r @param {string} rind @param {string} flesh
 */
function citrus(cx, cy, r, rind, flesh) {
  let spokes = '';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4 + 0.2;
    const dx = n((r - 5) * Math.cos(a));
    const dy = n((r - 5) * Math.sin(a));
    spokes += `M${n(cx - dx)} ${n(cy - dy)}L${n(cx + dx)} ${n(cy + dy)}`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rind}" ${ink(2.5)}/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r - 3}" fill="${CREAM}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r - 5}" fill="${flesh}"/>` +
    `<path d="${spokes}" stroke="${CREAM}" stroke-width="2"/>`;
}

/**
 * Rounded ice cube with a white glint.
 * @param {number} x @param {number} y centre @param {number} s size @param {number} a rotation (degrees)
 */
function ice(x, y, s, a) {
  const h = s / 2;
  const glint = `M${n(x - h + 4)} ${n(y + h - 5)}V${n(y - h + 4)}H${n(x + h - 5)}`;
  return `<g transform="rotate(${a} ${x} ${y})">` +
    `<rect x="${n(x - h)}" y="${n(y - h)}" width="${s}" height="${s}" rx="3.5" fill="${SKY}" ${ink(2)}/>` +
    `<path d="${glint}" fill="none" stroke="${WHITE}" stroke-width="2.5" stroke-linecap="round"/></g>`;
}

/**
 * Mint leaf with a vein; base at (x, y), pointing up before rotation.
 * @param {number} x @param {number} y @param {number} l length @param {number} a rotation (degrees)
 */
function leaf(x, y, l, a) {
  const w = n(l * 0.5);
  return `<g transform="rotate(${a} ${x} ${y})">` +
    `<path d="M${x} ${y}q${w} ${-w} 0 ${-l}q${-w} ${w} 0 ${l}Z" fill="${GREEN}" ${ink(2)}/>` +
    `<path d="M${x} ${y - 2}v${n(-l * 0.7)}" stroke="${LIME}" stroke-width="1.5" stroke-linecap="round"/></g>`;
}

/**
 * Roasted coffee bean with its crease.
 * @param {number} x @param {number} y centre @param {number} a rotation (degrees)
 */
const bean = (x, y, a) =>
  `<g transform="rotate(${a} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="5.5" ry="7.5" fill="${DARK}" ${ink(2)}/>` +
  `<path d="M${x} ${y - 5}c-3 3 3 7 0 10" fill="none" stroke="${CRUST}" stroke-width="1.6" stroke-linecap="round"/></g>`;

/* ------------------------------------------------------------------ */

/** Fluted "cutting chai" glass with steam, a star anise and green cardamom. */
function masalaChai() {
  const glass = 'M38 50L52 124Q75 133 98 124L112 50A37 9 0 0 0 38 50Z';
  let star = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 ? 5 : 13;
    star += `${i ? 'L' : 'M'}${n(118 + r * Math.cos(a))} ${n(117 + r * Math.sin(a))}`;
  }
  return [
    steam('M59 39c-7-6 6-10 0-16'), steam('M76 38c-9-7 9-12 0-19c-6-5 4-8 1-12'), steam('M93 39c-7-6 6-11 0-18'),
    '<g transform="rotate(-4 75 88)">',
    shadow(glass),
    `<path d="${glass}" fill="${WHITE}" ${ink()}/>`,
    `<path d="M40 60L53 114Q75 121 97 114L110 60Z" fill="${CRUST}"/>`,
    `<path d="M53 68l5 44M64 70l3 46M75 70v47M86 70l-3 46M97 68l-5 44" stroke="${BROWN}" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M53 114Q75 121 97 114" fill="none" ${ink(2)}/>`,
    `<path d="M58 122q17 4 34 0" fill="none" stroke="${SKY}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<ellipse cx="75" cy="60" rx="35" ry="8" fill="${GOLD}" ${ink(2)}/>`,
    `<path d="M50 62q25 7 50 0" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/>`,
    `<ellipse cx="75" cy="50" rx="37" ry="9" fill="none" ${ink()}/>`,
    `<path d="M46 66l8 42" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    '</g>',
    `<path d="${star}Z" fill="${BROWN}" ${ink(2)}/><circle cx="118" cy="117" r="3" fill="${DARK}"/>`,
    `<g transform="rotate(-35 30 114)"><ellipse cx="30" cy="114" rx="5.5" ry="9.5" fill="${LIME}" ${ink(2)}/>` +
      `<path d="M30 107v14" stroke="${GREEN}" stroke-width="1.5"/></g>`,
    `<g transform="rotate(55 37 127)"><ellipse cx="37" cy="127" rx="5" ry="8.5" fill="${LIME}" ${ink(2)}/></g>`,
  ].join('');
}

/** Terracotta kulhad with grooves, frothy chai, steam and a biscuit. */
function kulhadChai() {
  const cup = 'M34 54C34 82 46 112 56 124Q75 131 94 124C104 112 116 82 116 54A41 11 0 0 0 34 54Z';
  return [
    `<circle cx="117" cy="112" r="16" fill="${GOLD}" ${ink(2.5)}/>`,
    dots([[112, 106], [121, 104], [117, 113], [125, 115], [111, 119], [120, 122]], 1.8, BROWN),
    steam('M58 44c-7-6 6-10 0-16'), steam('M75 43c-9-7 9-12 0-19c-6-5 4-8 1-12'), steam('M92 44c-7-6 6-11 0-18'),
    '<g transform="rotate(3 75 90)">',
    shadow(cup),
    `<path d="${cup}" fill="${CLAY}" ${ink()}/>`,
    `<path d="M36 72Q75 86 114 72M42 94Q75 106 108 94" fill="none" stroke="${DARK}" stroke-width="2.5" stroke-linecap="round"/>`,
    dots([[60, 84], [88, 112], [96, 82], [68, 113]], 1.5, DARK),
    `<ellipse cx="75" cy="54" rx="41" ry="11" fill="${CLAY}" ${ink()}/>`,
    `<ellipse cx="75" cy="55" rx="34" ry="8" fill="${DARK}" ${ink(2)}/>`,
    `<ellipse cx="75" cy="57.5" rx="31" ry="6" fill="${CRUST}"/>`,
    `<path d="M54 57q8-3 16 0t16 0" fill="none" stroke="${CREAM}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<path d="M40 61q35 13 70 0" fill="none" stroke="${CREAM}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`,
    `<path d="M43 70q3 26 14 44" fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    '</g>',
  ].join('');
}

/**
 * Pink ceramic cappuccino cup on a saucer: latte-art heart in the crema, steam and flying coffee beans.
 * A wide, low cup + saucer keeps it apart from the chai glass, the clay kulhad and the tall iced cold-coffee glass.
 */
function hotCoffee() {
  const cup = 'M28 60C28 91 43 111 59 115Q68 118 77 115C93 111 108 91 108 60A40 16 0 0 0 28 60Z';
  const handle = 'M105 72C121 67 128 77 124.5 88C121.5 97 111 100 99 97';
  // Saucer edge: the band between the lower halves of the top face (cy 114) and the underside (cy 120).
  const saucer = 'M16 114A56 12.5 0 0 0 128 114V120A56 12.5 0 0 1 16 120Z';
  // Poured heart seen in perspective: lobes at the back, point towards the viewer.
  const heart = 'M68 72C63 69 52 64.5 52 59C52 54.5 58.5 52.5 63.5 52.5C66 52.5 68 53.5 68 55.5C68 53.5 70 52.5 72.5 52.5' +
    'C77.5 52.5 84 54.5 84 59C84 64.5 73 69 68 72Z';
  return [
    bean(23, 42, -25), bean(125, 34, 25),
    steam('M53 36c-7-6 6-10 0-16'), steam('M69 34c-9-7 9-12 0-19c-6-5 4-8 1-12'), steam('M85 36c-7-6 6-11 0-18'),
    sparkle(19, 84, 6),
    '<g transform="rotate(-3 72 100)">',
    shadow(saucer),
    `<path d="${saucer}" fill="${PINK}" ${ink()}/>`,
    `<ellipse cx="72" cy="114" rx="56" ry="12.5" fill="${WHITE}" ${ink()}/>`,
    `<ellipse cx="70" cy="114.5" rx="32" ry="7" fill="none" stroke="${SKY}" stroke-width="2.5"/>`,
    `<path d="${handle}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" transform="translate(4 4)"/>`,
    shadow(cup),
    `<path d="${handle}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`,
    `<path d="${handle}" fill="none" stroke="${PINK}" stroke-width="6" stroke-linecap="round"/>`,
    `<path d="${cup}" fill="${PINK}" ${ink()}/>`,
    `<path d="M36 77q3 22 18 32M41 70.5q.5 2 1.5 3.5" fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    `<ellipse cx="68" cy="60" rx="40" ry="16" fill="${WHITE}" ${ink()}/>`,
    `<ellipse cx="68" cy="62" rx="35" ry="13" fill="${DARK}" ${ink(2)}/>`,
    `<ellipse cx="68" cy="62.5" rx="31" ry="11" fill="${BROWN}"/>`,
    `<path d="${heart}" fill="${CREAM}"/>`,
    '</g>',
  ].join('');
}

/** Tall glass of iced coffee: froth, ice cubes, striped straw, flying coffee beans. */
function coldCoffee() {
  const glass = 'M44 40L50 124Q72 131 94 124L100 40A28 7 0 0 0 44 40Z';
  return [
    bean(26, 54, -25), bean(124, 88, 30), bean(28, 106, 15),
    '<g transform="rotate(5 72 84)">',
    shadow(glass),
    `<path d="${glass}" fill="${WHITE}" ${ink()}/>`,
    `<path d="M46 50L51 120Q72 126 93 120L98 50Z" fill="${BROWN}"/>`,
    `<path d="M50 76q10-6 20 0t22 0M52 98q10-6 20 0t20 0" fill="none" stroke="${CRUST}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M45.5 46L47 58q6 5 12 0q6 5 12 0q6 5 12 0q6 5 12 0q3 3 1.5-6L98.5 46Z" fill="${CREAM}" ${ink(2)}/>`,
    straw('M80 56L104 14', SKY),
    ice(60, 47, 15, -15), ice(78, 45, 13, 12),
    `<ellipse cx="72" cy="40" rx="28" ry="7" fill="none" ${ink()}/>`,
    `<path d="M50 66l4 48" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    '</g>',
    sparkle(118, 40, 7, WHITE),
  ].join('');
}

/** Generic red cola can (no logo) with a cola wave, rising bubbles and fizz. */
function colaCan() {
  const can = 'M53 30L48 40V118L52 125Q75 134 98 125L102 118V40L97 30A22 6 0 0 0 53 30Z';
  return [
    '<g transform="rotate(-10 75 80)">',
    shadow(can),
    `<path d="${can}" fill="${RED}" ${ink()}/>`,
    `<path d="M48 94q14-8 27 0t27 0V118L98 125Q75 134 52 125L48 118Z" fill="${DARK}"/>`,
    bubbles([[62, 106, 3], [86, 110, 2.5], [72, 82, 5], [90, 66, 3.5], [62, 60, 2.5]]),
    `<path d="M53 30L48 40Q75 47 102 40L97 30Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M48 118L52 125Q75 134 98 125L102 118Q75 126 48 118Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<ellipse cx="75" cy="30" rx="22" ry="6" fill="${WHITE}" ${ink(2.5)}/>`,
    `<ellipse cx="82" cy="30.5" rx="6" ry="2.4" fill="${DARK}"/>`,
    `<ellipse cx="70" cy="29.5" rx="7" ry="3" fill="${SKY}" ${ink(1.5)}/><ellipse cx="68" cy="29.5" rx="2.2" ry="1.1" fill="${WHITE}"/>`,
    `<path d="M57 48v62" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M66 52v18" stroke="${CREAM}" stroke-width="2.5" stroke-linecap="round"/>`,
    drop(92, 50), drop(80, 98),
    '</g>',
    bubbles([[88, 14, 3], [97, 22, 4], [79, 8, 2.5]]),
    sparkle(30, 40, 7), sparkle(122, 52, 6, WHITE),
  ].join('');
}

/** Silhouette shared by the generic soda cans (same outline as the cola can). */
const CAN = 'M53 30L48 40V118L52 125Q75 134 98 125L102 118V40L97 30A22 6 0 0 0 53 30Z';

/**
 * Generic soda can in the house style (no logo): coloured body, a wavy lower band, a round cream badge carrying `emblem`,
 * white shoulder and base rims, ring-pull, highlight stripes and condensation drops. Tilted by `tilt` degrees.
 * @param {{tilt: number, body: string, band: string, emblem: string}} look
 */
function sodaCan({tilt, body, band, emblem}) {
  return [
    `<g transform="rotate(${tilt} 75 80)">`,
    shadow(CAN),
    `<path d="${CAN}" fill="${body}" ${ink()}/>`,
    `<path d="M48 104q14-8 27 0t27 0V118L98 125Q75 134 52 125L48 118Z" fill="${band}"/>`,
    `<path d="M48 104q14-8 27 0t27 0" fill="none" ${ink(2)}/>`,
    bubbles([[60, 114, 2.5], [88, 116, 2]]),
    `<circle cx="75" cy="72" r="20" fill="${CREAM}" ${ink(2.5)}/>`,
    emblem,
    `<path d="M53 30L48 40Q75 47 102 40L97 30Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M48 118L52 125Q75 134 98 125L102 118Q75 126 48 118Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<ellipse cx="75" cy="30" rx="22" ry="6" fill="${WHITE}" ${ink(2.5)}/>`,
    `<ellipse cx="82" cy="30.5" rx="6" ry="2.4" fill="${DARK}"/>`,
    `<ellipse cx="70" cy="29.5" rx="7" ry="3" fill="${SKY}" ${ink(1.5)}/><ellipse cx="68" cy="29.5" rx="2.2" ry="1.1" fill="${WHITE}"/>`,
    `<path d="M55 50v42" stroke="${CREAM}" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M95 52v10" stroke="${CREAM}" stroke-width="2.5" stroke-linecap="round"/>`,
    drop(96, 52), drop(60, 94),
    '</g>',
  ].join('');
}

/** Generic lime-lemon soda can (no logo): lime-green body, deep-green wave, lemon + lime wheels badge, a lime wedge. */
function limeCan() {
  return [
    sodaCan({
      tilt: 9,
      body: LIME,
      band: GREEN,
      emblem: citrus(68, 77, 10.5, YELLOW, YELLOW) + citrus(82, 67, 10.5, GREEN, LIME),
    }),
    `<circle cx="118" cy="116" r="15" fill="${INK}" transform="translate(3 3)"/>`,
    citrus(118, 116, 15, GREEN, LIME),
    leaf(108, 102, 11, -35),
    bubbles([[60, 14, 3.5], [50, 24, 2.5], [69, 6, 2]]),
    sparkle(28, 46, 7), sparkle(122, 40, 6, WHITE), sparkle(26, 108, 5, WHITE),
  ].join('');
}

/** Generic orange soda can (no logo): orange body, sunny yellow wave, orange-wheel badge with a leaf, a whole orange. */
function orangeCan() {
  return [
    sodaCan({
      tilt: -7,
      body: ORANGE,
      band: YELLOW,
      emblem: citrus(75, 74, 13, ORANGE, GOLD) + leaf(81, 61, 11, 50),
    }),
    `<circle cx="34" cy="116" r="15" fill="${INK}" transform="translate(3 3)"/>`,
    `<circle cx="34" cy="116" r="15" fill="${ORANGE}" ${ink(2.5)}/>`,
    dots([[29, 121], [37, 123], [40, 114]], 1.5, GOLD),
    `<path d="M26 111q3-5 8-6" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/>`,
    leaf(35, 102, 12, -40),
    bubbles([[92, 12, 3.5], [102, 22, 2.5], [84, 4, 2]]),
    sparkle(124, 56, 7), sparkle(24, 54, 6, WHITE), sparkle(122, 112, 5, WHITE),
  ].join('');
}

/** Lime-green lemon soda: bubbles, a floating slice, lemon wheel on the rim, pink straw. */
function lemonFizz() {
  const glass = 'M44 40L54 124Q74 131 94 124L104 40A30 7.5 0 0 0 44 40Z';
  return [
    '<g transform="rotate(-5 74 84)">',
    shadow(glass),
    `<path d="${glass}" fill="${WHITE}" ${ink()}/>`,
    `<path d="M46 50L55 119Q74 125 93 119L102 50Z" fill="${LIME}"/>`,
    citrus(68, 94, 13, YELLOW, YELLOW),
    bubbles([[86, 70, 3.5], [58, 70, 2.5], [88, 104, 3], [80, 86, 2]]),
    straw('M84 60L60 12', PINK),
    `<ellipse cx="74" cy="50" rx="29" ry="6.5" fill="${CREAM}" ${ink(2)}/>`,
    `<ellipse cx="74" cy="40" rx="30" ry="7.5" fill="none" ${ink()}/>`,
    `<path d="M51 62l6 50" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    '</g>',
    citrus(104, 44, 18, YELLOW, YELLOW),
    bubbles([[40, 26, 4], [30, 40, 2.5], [48, 14, 3]]),
    sparkle(124, 80, 6, WHITE),
  ].join('');
}

/** Orange soda bottle with its cap popping off, fizz, and a whole orange. */
function orangeFizz() {
  const bottle = 'M67 34V50C67 58 51 64 51 76V120Q51 128 59 128H91Q99 128 99 120V76C99 64 83 58 83 50V34Z';
  return [
    '<g transform="rotate(-8 75 80)">',
    shadow(bottle),
    `<path d="${bottle}" fill="${ORANGE}" ${ink()}/>`,
    `<path d="M67 34V46H83V34Z" fill="${WHITE}" ${ink(2)}/>`,
    `<rect x="64" y="28" width="22" height="8" rx="3" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M51 86H99V108H51Z" fill="${YELLOW}" ${ink(2.5)}/>`,
    `<path d="M56 97q5-5 10 0t10 0t10 0t9 0" fill="none" stroke="${WHITE}" stroke-width="3.5" stroke-linecap="round"/>`,
    bubbles([[62, 74, 3], [86, 72, 2.5], [76, 62, 2], [88, 118, 2.5], [64, 117, 2]]),
    `<path d="M57 78v4M57 114v6" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    '</g>',
    `<path d="M88 26l6-4M90 32l7-1" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<g transform="rotate(25 106 16)"><path d="M95 12h22v6${'l-2.2 3-2.2-3'.repeat(5)}Z" fill="${RED}" ${ink(2)}/></g>`,
    bubbles([[66, 18, 4.5], [57, 10, 3], [76, 10, 2.5], [48, 22, 2]]),
    `<circle cx="117" cy="113" r="15" fill="${ORANGE}" ${ink(2.5)}/>`,
    dots([[112, 118], [120, 120], [123, 111]], 1.5, GOLD),
    `<path d="M109 108q3-5 8-6" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/>`,
    leaf(118, 99, 12, 55),
    sparkle(30, 46, 7), sparkle(28, 100, 5, WHITE),
  ].join('');
}

/** Glass mug of virgin mojito: mint liquid, lime wheel, ice, crushed-ice top and a big mint sprig. */
function mintMojito() {
  const jar = 'M36 46V114Q36 126 48 126H86Q98 126 98 114V46A31 7 0 0 0 36 46Z';
  const handle = 'M98 66C115 66 118 72 118 84S115 102 98 102';
  return [
    `<path d="${handle}" fill="none" stroke="${INK}" stroke-width="11" transform="translate(4 4)"/>`,
    shadow(jar),
    `<path d="${handle}" fill="none" stroke="${INK}" stroke-width="11"/>`,
    `<path d="${handle}" fill="none" stroke="${WHITE}" stroke-width="5"/>`,
    `<path d="${jar}" fill="${WHITE}" ${ink()}/>`,
    `<path d="M38 60V113Q38 124 49 124H85Q96 124 96 113V60Z" fill="${MINT}"/>`,
    citrus(55, 104, 12, GREEN, LIME),
    leaf(82, 116, 13, 22), leaf(50, 90, 12, -28),
    ice(68, 82, 14, 20), ice(86, 98, 12, -10),
    bubbles([[54, 70, 2], [82, 72, 2.5], [72, 112, 2]]),
    straw('M76 60L96 14', YELLOW),
    `<path d="M37 61q1-7 9-6q3-7 11-4q6-6 13-1q6-5 13 0q7-4 11 2q7-1 8 6Z" fill="${WHITE}" ${ink(2)}/>`,
    leaf(46, 58, 25, -36), leaf(57, 56, 32, -10), leaf(68, 57, 25, 18), leaf(40, 62, 17, -68),
    `<ellipse cx="67" cy="46" rx="31" ry="7" fill="none" ${ink()}/>`,
    `<path d="M43 68v42" stroke="${CREAM}" stroke-width="4" stroke-linecap="round"/>`,
    sparkle(118, 34, 7), sparkle(24, 98, 5, WHITE),
  ].join('');
}

/** Chocolate shake in a tulip soda glass: whipped-cream swirl, cherry, sprinkles, candy straw. */
function milkshake() {
  const bowl = 'M45 60L58 102Q62 109 67 112H83Q88 109 92 102L105 60Z';
  return [
    straw('M64 52L40 10', RED),
    `<ellipse cx="79" cy="128" rx="20" ry="5.5" fill="${INK}"/>`,
    shadow(bowl),
    `<ellipse cx="75" cy="124" rx="20" ry="5.5" fill="${WHITE}" ${ink()}/>`,
    `<path d="M69.5 110L71.5 120H78.5L80.5 110Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="${bowl}" fill="${BROWN}" ${ink()}/>`,
    `<path d="M47 62H103L101.5 67q-2.5 10-5 0l-.5-1q-2 7-4.5 0H65v2q-2.5 10-5 0v-1q-2 6-4 0H52q-2 12-4.5 0Z" fill="${DARK}"/>`,
    `<path d="M53 72l9 28" stroke="${CREAM}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    `<path d="M48 66h54a8 8 0 0 0 0-16H48a8 8 0 0 0 0 16Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M54 52h42a7.5 7.5 0 0 0 0-15H54a7.5 7.5 0 0 0 0 15Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M62 39h26a7 7 0 0 0 0-14c-4 0-6-6-12-8c2 4-1 8-6 8h-8a7 7 0 0 0 0 14Z" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M44 58q6 6 12 1t11 2t11-2t11 2t10-2" fill="none" stroke="${DARK}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<path d="M80 46q8 3 16 0M64 33q6 3 12 0" fill="none" stroke="${SKY}" stroke-width="2" stroke-linecap="round"/>`,
    `<g stroke-width="3" stroke-linecap="round"><path d="M58 45l4-2M86 41l3 3" stroke="${PINK}"/>` +
      `<path d="M72 46l4 1M66 31l2 3" stroke="${YELLOW}"/><path d="M92 33l-2 3M80 31l3 2" stroke="${MINT}"/></g>`,
    `<path d="M84 16q2-6 8-8" fill="none" stroke="${GREEN}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<circle cx="83" cy="18" r="7" fill="${RED}" ${ink(2.5)}/>`,
    `<path d="M80 15l2-1" stroke="${CREAM}" stroke-width="2" stroke-linecap="round"/>`,
    sparkle(120, 38, 7), sparkle(28, 84, 5, WHITE),
  ].join('');
}

/** Tall glass of kesar lassi under a thick malai cap with pista, saffron and a rose petal; steel spoon in. */
function lassi() {
  const glass = 'M42 52L50 124Q75 132 100 124L108 52A33 8 0 0 0 42 52Z';
  // Lumpy malai cap overflowing the rim, with three drips over the front of the glass.
  const malai = 'M36 58q-3-9 6-12q1-8 11-7q5-7 14-3q7-6 15 0q8-5 14 1q10-1 11 7q8 3 6 12q-1 4-4 3v8q0 5-4 1v-7' +
    'q-10 3-19 2v10q0 5-4 1v-11q-14 1-25-2v5q0 5-4 1v-7q-5-1-6-2Z';
  // Chopped pistachio: [x, y, rotation] of each chunk's centre.
  const pista = [[59, 47, -20], [87, 43, 25], [74.5, 51, 0], [98.5, 54, -30], [49.5, 55, 30]]
    .map(([x, y, a]) => `<rect x="${x - 3}" y="${y - 2}" width="6" height="4" rx="1.5" transform="rotate(${a} ${x} ${y})"/>`)
    .join('');
  return [
    `<path d="M89 46L105.5 15.5A6.5 6.5 0 0 1 116.5 22.5L94 49Z" fill="${SKY}" ${ink(2.5)}/>`,
    `<path d="M108 19.5q2.5-2 4 0" fill="none" stroke="${WHITE}" stroke-width="2.5" stroke-linecap="round"/>`,
    shadow(glass),
    `<path d="${glass}" fill="${WHITE}" ${ink()}/>`,
    `<path d="M44 60L50.5 114Q75 121 99.5 114L106 60Z" fill="${SOFT_YELLOW}"/>`,
    `<path d="M50.5 114Q75 121 99.5 114" fill="none" ${ink(2)}/>`,
    `<path d="M57 122q18 4 36 0" fill="none" stroke="${SKY}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<path d="M48 70l6 40" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="${malai}" fill="${WHITE}" ${ink(2.5)}/>`,
    `<path d="M44 49q4-4 9-4M66 41q5-3 11-1M95 45q5 1 6 5" fill="none" stroke="${SOFT_YELLOW}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<g fill="${LIME}" stroke="${GREEN}" stroke-width="1.5">${pista}</g>`,
    `<path d="M65 43q2-4 5-4M90 49q1 4 5 5M80 54q3-2 6 0M52 46q-1-3 1-6" fill="none" stroke="${RED}" stroke-width="1.8"` +
      ' stroke-linecap="round"/>',
    `<path d="M70 37q5-8 11 0q-5 5-11 0Z" fill="${PINK}" ${ink(1.5)}/>`,
    sparkle(24, 40, 7), sparkle(126, 80, 5, WHITE),
  ].join('');
}

/** @type {Record<string, {label: string, group: string, keywords: string[], svg: string}>} */
export default {
  'masala-chai': {
    label: 'Masala Chai',
    group: 'drinks',
    keywords: ['chai', 'masala chai', 'cutting chai', 'tea', 'adrak', 'elaichi', 'garam', 'hot drink'],
    svg: masalaChai(),
  },
  'kulhad-chai': {
    label: 'Kulhad Chai',
    group: 'drinks',
    keywords: ['chai', 'kulhad', 'kullad', 'kulhad chai', 'tea', 'mitti', 'clay cup', 'hot drink'],
    svg: kulhadChai(),
  },
  'hot-coffee': {
    label: 'Hot Coffee',
    group: 'drinks',
    keywords: ['hot coffee', 'coffee', 'filter coffee', 'kaapi', 'cappuccino', 'latte', 'espresso', 'beaten coffee', 'mocha',
      'cafe', 'cup', 'hot drink'],
    svg: hotCoffee(),
  },
  'cold-coffee': {
    label: 'Cold Coffee',
    group: 'drinks',
    keywords: ['cold coffee', 'coffee', 'iced coffee', 'frappe', 'kaapi', 'cafe', 'thanda', 'chilled'],
    svg: coldCoffee(),
  },
  'cola-can': {
    label: 'Cola Can',
    group: 'drinks',
    keywords: ['cola', 'can', 'soda', 'cold drink', 'soft drink', 'thanda', 'fizz', 'tin'],
    svg: colaCan(),
  },
  'lime-can': {
    label: 'Lime Soda Can',
    group: 'drinks',
    keywords: ['lime', 'lemon', 'nimbu', 'lime soda', 'lemon soda', 'can', 'soda', 'cold drink', 'soft drink', 'fizz', 'tin'],
    svg: limeCan(),
  },
  'orange-can': {
    label: 'Orange Soda Can',
    group: 'drinks',
    keywords: ['orange', 'santra', 'narangi', 'orange soda', 'can', 'soda', 'cold drink', 'soft drink', 'fizz', 'tin'],
    svg: orangeCan(),
  },
  'lemon-fizz': {
    label: 'Lemon Fizz',
    group: 'drinks',
    keywords: ['lemon soda', 'nimbu soda', 'nimbu pani', 'shikanji', 'lemonade', 'fresh lime', 'fizz', 'banta'],
    svg: lemonFizz(),
  },
  'orange-fizz': {
    label: 'Orange Fizz',
    group: 'drinks',
    keywords: ['orange soda', 'orange', 'santra', 'narangi', 'fizz', 'soda', 'bottle', 'cold drink'],
    svg: orangeFizz(),
  },
  'mint-mojito': {
    label: 'Mint Mojito',
    group: 'drinks',
    keywords: ['mojito', 'mint', 'pudina', 'mocktail', 'virgin mojito', 'lime', 'cooler', 'mason jar'],
    svg: mintMojito(),
  },
  milkshake: {
    label: 'Milkshake',
    group: 'drinks',
    keywords: ['milkshake', 'shake', 'chocolate shake', 'thick shake', 'chocolate', 'whipped cream', 'cherry'],
    svg: milkshake(),
  },
  lassi: {
    label: 'Lassi',
    group: 'drinks',
    keywords: ['lassi', 'sweet lassi', 'mango lassi', 'malai', 'dahi', 'chaas', 'kesar', 'punjabi'],
    svg: lassi(),
  },
};
