// @ts-check
// Stall themes (starter templates) for ManageYourStall (ARCHITECTURE.md §5 and §16.5).
// Pure data: no imports, no DOM, no storage, deterministic. Money is integer paise (₹1 = 100).
// buildTemplate() assembles brand-new objects on every call, so callers may mutate the result freely.
// Art ids come from library.REQUIRED_ART_IDS; tints, patterns and tags from constants.mjs (TINT_IDS, PATTERN_IDS, TAG_IDS).

/**
 * The look of a stall theme: what applyTheme() copies into config.theme (plus themeId and heroImage, which it owns).
 * @typedef {object} ThemeLook
 * @property {string} accent        '#RRGGBB' primary colour (one of constants.ACCENTS); drives CSS --accent
 * @property {string} secondary     '#RRGGBB' second palette colour for hero blobs, chips and highlights
 * @property {string[]} heroArt     3 library art ids composing the hero illustration (left, centre, right)
 * @property {string} heroTint      TINT id for the hero background
 * @property {string} heroPattern   PATTERN id for the hero background
 */

/**
 * Picker-card metadata for one stall theme.
 * @typedef {object} TemplateInfo
 * @property {string} id           stable template id (stored as config.templateId / config.theme.themeId)
 * @property {string} name         card title
 * @property {string} emoji        card emoji
 * @property {string} tagline      hero line; also the built template's `tagline`
 * @property {string} description  one-sentence summary of what the menu contains
 * @property {string} accent       '#RRGGBB' theme accent (one of constants.ACCENTS; same as theme.accent)
 * @property {string} art          library illustration id for the card
 * @property {Readonly<Omit<ThemeLook, 'heroArt'> & {heroArt: readonly string[]}>} theme  the stall look (frozen)
 */

/** @typedef {{id: string, name: string}} Category */
/** @typedef {{productId: string, quantity: number}} BundlePart */
/**
 * A complete §2 Product (every field present).
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} subtitle
 * @property {string} categoryId
 * @property {string} size
 * @property {number | null} price
 * @property {boolean} priceLocked
 * @property {string} art
 * @property {string | null} image
 * @property {string} tint
 * @property {string} pattern
 * @property {string[]} tags
 * @property {boolean} active
 * @property {boolean} soldOut
 * @property {boolean} customizable
 * @property {string} stockKey
 * @property {number} stockUnits
 * @property {BundlePart[] | null} bundle
 */
/** @typedef {{id: string, name: string, price: number}} Addon */
/** @typedef {{id: string, name: string, fee: number, art: string}} Game */
/**
 * @typedef {object} DiscountRule
 * @property {string} id
 * @property {string} label
 * @property {'flat' | 'percent'} type
 * @property {number} value
 * @property {number} minimum
 * @property {boolean} active
 */
/** @typedef {{id: string, label: string, amount: number}} MissionItem */
/**
 * Break-even mission. Templates use 'ledger' mode (§16.1): break-even = Σ bills in the expense ledger, and `items` are only
 * suggested bills for quick-add (their amounts are typical costs, not a target).
 * @typedef {{mode: 'ledger' | 'total' | 'itemized', total: number, items: MissionItem[]}} Mission
 */
/** @typedef {{id: string, title: string, type: 'orders' | 'revenue' | 'recovery' | 'items' | 'games', target: number}} Milestone */

/**
 * What buildTemplate() returns: everything applyTemplate()/initialState() copy into the config, plus hero copy, accent and
 * the theme look.
 * @typedef {object} BuiltTemplate
 * @property {string} templateId
 * @property {string} accent
 * @property {ThemeLook} theme
 * @property {string} tagline
 * @property {string} subTagline
 * @property {Category[]} categories
 * @property {Product[]} products
 * @property {Addon[]} addons
 * @property {string[]} flavours
 * @property {Game[]} games
 * @property {DiscountRule[]} discounts
 * @property {boolean} allowCustomDiscount
 * @property {Mission} mission
 * @property {Milestone[]} milestones
 * @property {boolean} inventory
 * @property {Record<string, number>} stock
 * @property {boolean} kitchenQueue
 */

/**
 * The template-specific half of a build (shared discounts and milestones are added by buildTemplate).
 * @typedef {object} Menu
 * @property {string} subTagline
 * @property {Category[]} categories
 * @property {Product[]} products
 * @property {Addon[]} addons
 * @property {string[]} flavours
 * @property {Game[]} games
 * @property {Mission} mission
 * @property {Record<string, number>} stock
 */

/**
 * Compact product definition used in the menus below. Prices are whole rupees here and become paise in section().
 * @typedef {object} Row
 * @property {string} id
 * @property {string} name
 * @property {string} subtitle
 * @property {number} rupees
 * @property {string} art
 * @property {string} tint
 * @property {string} [pattern]           default 'none'
 * @property {string} [size]              default ''
 * @property {string[]} [tags]            default []
 * @property {boolean} [customizable]     default false
 * @property {string} [stockKey]          default '' (untracked)
 * @property {number} [stockUnits]        default 1
 * @property {Array<[string, number]>} [bundle]  [productId, quantity] pairs; marks a combo
 */

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Freeze one picker card (and its theme look) so UI code can never edit the shared catalogue by accident.
 * @param {TemplateInfo} info
 * @returns {Readonly<TemplateInfo>}
 */
function card(info) {
  const theme = Object.freeze({...info.theme, heroArt: Object.freeze([...info.theme.heroArt])});
  return Object.freeze({...info, theme});
}

/**
 * Stall themes in picker order: six pre-built stalls, then the blank stall. The first one ('street-chaat') is the default
 * for new installs. Frozen: copy an entry (and its theme) before changing anything.
 * @type {ReadonlyArray<Readonly<TemplateInfo>>}
 */
export const TEMPLATES = Object.freeze([
  card({
    id: 'street-chaat',
    name: 'Pataka Street Chaat & Snacks',
    emoji: '🧨',
    tagline: 'Little packets. Big fest energy.',
    description:
      'Veggie, corn and cheese chips chaat in two sizes, pani puri, bhel, samosa, kachori, aloo tikki, fries, fizz and combos.',
    accent: '#FFDD35',
    art: 'packet',
    theme: {accent: '#FFDD35', secondary: '#FF4D87', heroArt: ['pani-puri', 'packet', 'samosa'], heroTint: 'coral',
      heroPattern: 'sunburst'},
  }),
  card({
    id: 'snacks-pizza',
    name: 'Pizza & Fizz Hub',
    emoji: '🍕',
    tagline: 'Hot slices. Cold fizz. Zero wait.',
    description: 'Margherita to corn-cheese pizza, fries, loaded nachos, a veg burger, three fizz cans and two meal combos.',
    accent: '#FF6B5B',
    art: 'cheese-pizza',
    theme: {accent: '#FF6B5B', secondary: '#8FD3FF', heroArt: ['lime-can', 'cheese-pizza', 'orange-can'], heroTint: 'peach',
      heroPattern: 'dots'},
  }),
  card({
    id: 'chai-maggi',
    name: 'Chai, Coffee & Maggi Point',
    emoji: '☕',
    tagline: 'Kadak chai. Hot Maggi. Happy campus.',
    description: 'Masala and kulhad chai, hot and cold coffee, Maggi by the half or full plate, samosas, sandwiches and combos.',
    accent: '#FF9F43',
    art: 'kulhad-chai',
    theme: {accent: '#FF9F43', secondary: '#FFDD35', heroArt: ['kulhad-chai', 'maggi', 'cold-coffee'], heroTint: 'cream',
      heroPattern: 'stripes'},
  }),
  card({
    id: 'momo-corner',
    name: 'Momo & Fast-Food Corner',
    emoji: '🥟',
    tagline: 'Hot momos. Loaded rolls. Happy crowd.',
    description:
      'Steamed and fried momos by the half or full plate, burger, frankie, sandwich, pav bhaji, chole bhature, mojito and combos.',
    accent: '#7EE0B5',
    art: 'steamed-momos',
    theme: {accent: '#7EE0B5', secondary: '#FF6B5B', heroArt: ['frankie-roll', 'steamed-momos', 'burger'], heroTint: 'mint',
      heroPattern: 'zigzag'},
  }),
  card({
    id: 'sweet-tooth',
    name: 'Sweet Tooth & Dessert Bar',
    emoji: '🍨',
    tagline: 'Sweet cravings? Sorted.',
    description: 'Brownie sundae, gulab jamun, kulfi, thick milkshakes, mango lassi, cold coffee and two sweet combos.',
    accent: '#FF4D87',
    art: 'brownie-sundae',
    theme: {accent: '#FF4D87', secondary: '#C7B6FF', heroArt: ['kulfi', 'brownie-sundae', 'milkshake'], heroTint: 'pink',
      heroPattern: 'grid'},
  }),
  card({
    id: 'drinks-games',
    name: 'Mela Games & Lucky Zone',
    emoji: '🎡',
    tagline: 'Sip it. Play it. Win it.',
    description: 'Four paid mela games (Ring Toss, Spin the Wheel, Dart Game, Lucky Cup) plus fizz, mojitos, shakes and kulfi.',
    accent: '#8FD3FF',
    art: 'spin-wheel',
    theme: {accent: '#8FD3FF', secondary: '#B9F36B', heroArt: ['ring-toss', 'spin-wheel', 'lucky-cup'], heroTint: 'sky',
      heroPattern: 'sunburst'},
  }),
  card({
    id: 'blank',
    name: 'Blank stall',
    emoji: '✨',
    tagline: 'Your stall. Your rules.',
    description:
      'Start from scratch with empty Snacks, Drinks and Combos categories, plus discounts, bill ideas and milestones ready to edit.',
    accent: '#C7B6FF',
    art: 'chips-packet',
    theme: {accent: '#C7B6FF', secondary: '#7EE0B5', heroArt: ['samosa', 'chips-packet', 'cola-can'],
      heroTint: 'lavender', heroPattern: 'none'},
  }),
]);

/**
 * Retired template ids that still build (old configs, links and backups may carry them). Not listed in TEMPLATES.
 * @type {Readonly<Record<string, string>>}
 */
export const TEMPLATE_ALIASES = Object.freeze({'chaat-momo': 'momo-corner'});

/**
 * The listed template id for `id` (following TEMPLATE_ALIASES), or null when it is not a known template.
 * @param {unknown} id
 * @returns {string | null}
 */
export function resolveTemplateId(id) {
  if (typeof id !== 'string') return null;
  const canonical = Object.hasOwn(TEMPLATE_ALIASES, id) ? TEMPLATE_ALIASES[id] : id;
  return TEMPLATES.some(t => t.id === canonical) ? canonical : null;
}

/**
 * Build a fresh copy of a stall theme: menu, add-ons, flavours, games, discounts, mission (ledger mode with suggested bills),
 * milestones and stock pools, plus the hero copy, accent and theme look. Every call returns brand-new objects (nothing is
 * shared with earlier calls or with TEMPLATES). Suggested prices are integer paise. `withPrices: false` sets every product
 * price to null (stall setup mode: visible but not sellable until priced); add-on prices, game fees and suggested bill
 * amounts keep their values because they cannot be "unset". Aliases (TEMPLATE_ALIASES) build their listed template, so
 * `templateId` is always a listed id.
 * @param {string} id one of TEMPLATES[].id (or an alias)
 * @param {{withPrices?: boolean}} [options]
 * @returns {BuiltTemplate}
 * @throws {Error} when `id` is not a known template
 */
export function buildTemplate(id, options = {}) {
  const {withPrices = true} = options || {};
  const canonical = resolveTemplateId(id);
  const info = canonical ? TEMPLATES.find(t => t.id === canonical) : undefined;
  const menu = info ? MENUS.get(info.id) : undefined;
  if (!info || !menu) throw new Error(`Unknown stall template "${String(id)}".`);
  const m = menu();
  if (!withPrices) for (const p of m.products) p.price = null;
  return {
    templateId: info.id,
    accent: info.accent,
    theme: {...info.theme, heroArt: [...info.theme.heroArt]},
    tagline: info.tagline,
    subTagline: m.subTagline,
    categories: m.categories,
    products: m.products,
    addons: m.addons,
    flavours: m.flavours,
    games: m.games,
    discounts: discountRules(),
    allowCustomDiscount: true,
    mission: m.mission,
    milestones: milestoneList(m.games.length > 0),
    inventory: false,
    stock: m.stock,
    kitchenQueue: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------------

/** Whole rupees → integer paise. @param {number} rupees */
const rs = rupees => rupees * 100;

/**
 * Expand compact rows into fully populated §2 products of one category.
 * @param {string} categoryId
 * @param {Row[]} rows
 * @returns {Product[]}
 */
function section(categoryId, rows) {
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    categoryId,
    size: row.size || '',
    price: rs(row.rupees),
    priceLocked: false,
    art: row.art,
    image: null,
    tint: row.tint,
    pattern: row.pattern || 'none',
    tags: [...(row.tags || [])],
    active: true,
    soldOut: false,
    customizable: !!row.customizable,
    stockKey: row.stockKey || '',
    stockUnits: row.stockUnits || 1,
    bundle: row.bundle ? row.bundle.map(([productId, quantity]) => ({productId, quantity})) : null,
  }));
}

/**
 * The three 1-tap checkout discounts every template starts with (the festive one starts switched off).
 * @returns {DiscountRule[]}
 */
function discountRules() {
  return [
    {id: 'reel-story', label: 'Reel story? ₹10 off', type: 'flat', value: rs(10), minimum: 0, active: true},
    {id: 'friends-faculty', label: 'Friends & faculty ₹20 off', type: 'flat', value: rs(20), minimum: rs(100), active: true},
    {id: 'festive-10', label: 'Festive 10% off', type: 'percent', value: 10, minimum: rs(200), active: false},
  ];
}

/**
 * The standard milestone ladder (§5 / §13.5), plus "Game on" when the stall runs games.
 * @param {boolean} withGames
 * @returns {Milestone[]}
 */
function milestoneList(withGames) {
  /** @type {Milestone[]} */
  const list = [
    {id: 'first-sale', title: 'First sale', type: 'orders', target: 1},
    {id: 'club-1000', title: '₹1,000 Club', type: 'revenue', target: rs(1000)},
    {id: 'crowd-magnet', title: 'Crowd magnet', type: 'orders', target: 25},
    {id: 'halfway-there', title: 'Halfway there', type: 'recovery', target: 50},
    {id: 'break-even-boss', title: 'Break-even boss', type: 'recovery', target: 100},
    {id: 'dhamaka-10000', title: '₹10,000 Dhamaka', type: 'revenue', target: rs(10000)},
  ];
  if (withGames) list.push({id: 'game-on', title: 'Game on', type: 'games', target: 1});
  return list;
}

/**
 * Ledger-mode mission (§16.1): break-even follows the bills the team records, so `total` is 0 and the five standard lines
 * are only suggested bills (typical amounts for this kind of stall) for the quick-add chips.
 * @param {[number, number, number, number, number]} rupees stall rent, raw materials, disposables, banner, helper
 * @returns {Mission}
 */
function ledgerMission([rent, raw, disposables, banner, helper]) {
  return {
    mode: 'ledger',
    total: 0,
    items: [
      {id: 'stall-rent', label: 'Stall rent', amount: rs(rent)},
      {id: 'raw-materials', label: 'Raw materials', amount: rs(raw)},
      {id: 'disposables-plates', label: 'Disposables & plates', amount: rs(disposables)},
      {id: 'banner-decor', label: 'Banner & decor', amount: rs(banner)},
      {id: 'helper-cost', label: 'Helper cost', amount: rs(helper)},
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Menus (one function per template, so every build starts from new objects)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Pataka Street Chaat & Snacks: the original chips-chaat stall (same ids, prices, flavours, add-ons and stock pools) plus
 * the street-chaat classics.
 * @returns {Menu}
 */
function streetChaat() {
  return {
    subTagline: 'Chips chaat, pani puri and hot samosas, plus ice-cold fizz — made fresh, served fast.',
    categories: [
      {id: 'chips-chaat', name: 'Chips Chaat'},
      {id: 'street-chaat', name: 'Street Chaat'},
      {id: 'hot-crispy', name: 'Hot & Crispy'},
      {id: 'fizz', name: 'Fizz'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('chips-chaat', [
        {id: 'veggie-chips-chaat-small', name: 'Veggie Chips Chaat · Small', size: 'Small', rupees: 40,
          subtitle: 'Crunchy, tangy, made to order',
          art: 'packet', tint: 'lime', pattern: 'none', customizable: true, stockKey: 'chips-small'},
        {id: 'veggie-chips-chaat-large', name: 'Veggie Chips Chaat · Large', size: 'Large', rupees: 60,
          subtitle: 'Big packet, loaded with veggies and chutney',
          art: 'packet', tint: 'mint', pattern: 'stripes', customizable: true, stockKey: 'chips-large'},
        {id: 'corn-chips-chaat-small', name: 'Corn Chips Chaat · Small', size: 'Small', rupees: 50,
          subtitle: 'Sweet corn, masala and a squeeze of nimbu',
          art: 'corn', tint: 'sky', pattern: 'none', customizable: true, stockKey: 'chips-small'},
        {id: 'corn-chips-chaat-large', name: 'Corn Chips Chaat · Large', size: 'Large', rupees: 70,
          subtitle: 'Extra corn, extra crunch, extra happy',
          art: 'corn', tint: 'lavender', pattern: 'stripes', customizable: true, stockKey: 'chips-large'},
        {id: 'cheese-chips-chaat-small', name: 'Cheese Chips Chaat · Small', size: 'Small', rupees: 60,
          subtitle: 'Cheesy, crunchy, totally worth it',
          art: 'chips-packet', tint: 'peach', pattern: 'none', tags: ['BESTSELLER'], customizable: true, stockKey: 'chips-small'},
        {id: 'cheese-chips-chaat-large', name: 'Cheese Chips Chaat · Large', size: 'Large', rupees: 80,
          subtitle: 'Max cheese for max cravings',
          art: 'chips-packet', tint: 'yellow', pattern: 'stripes', customizable: true, stockKey: 'chips-large'},
      ]),
      ...section('street-chaat', [
        {id: 'pani-puri', name: 'Pani Puri', rupees: 30,
          subtitle: '6 puris with teekha and meetha pani',
          art: 'pani-puri', tint: 'lime', pattern: 'dots', tags: ['BESTSELLER'], stockKey: 'puris', stockUnits: 6},
        {id: 'bhel-puri', name: 'Bhel Puri', rupees: 40,
          subtitle: 'Puffed rice, sev, onion and chutneys',
          art: 'bhel-puri', tint: 'yellow', pattern: 'zigzag'},
        {id: 'aloo-tikki', name: 'Aloo Tikki', rupees: 40,
          subtitle: '2 crispy tikkis with chole and chutneys',
          art: 'aloo-tikki', tint: 'coral', pattern: 'dots', stockKey: 'tikkis', stockUnits: 2},
      ]),
      ...section('hot-crispy', [
        {id: 'samosa', name: 'Samosa', rupees: 20,
          subtitle: 'Crisp, spicy aloo filling + green chutney',
          art: 'samosa', tint: 'cream', pattern: 'zigzag', stockKey: 'samosas'},
        {id: 'kachori', name: 'Kachori', rupees: 30,
          subtitle: 'Khasta dal kachori with tangy aloo sabzi',
          art: 'kachori', tint: 'peach', pattern: 'grid', stockKey: 'kachoris'},
        {id: 'peri-peri-fries', name: 'Peri Peri Fries', rupees: 70,
          subtitle: 'Golden fries shaken in fiery peri peri',
          art: 'peri-peri-fries', tint: 'coral', pattern: 'zigzag', tags: ['SPICY'], stockKey: 'fries'},
        {id: 'french-fries', name: 'French Fries', rupees: 60,
          subtitle: 'Classic salted, crisp and golden',
          art: 'french-fries', tint: 'cream', pattern: 'dots', stockKey: 'fries'},
      ]),
      ...section('fizz', [
        {id: 'cola', name: 'Cola', rupees: 30,
          subtitle: 'Ice-cold and extra fizzy',
          art: 'cola-can', tint: 'sky', pattern: 'dots', stockKey: 'cola'},
        {id: 'lemon-fizz', name: 'Lemon Fizz', rupees: 30,
          subtitle: 'Zesty lemon-lime bubbles',
          art: 'lemon-fizz', tint: 'peach', pattern: 'dots', stockKey: 'lemon-fizz'},
        {id: 'orange-fizz', name: 'Orange Fizz', rupees: 30,
          subtitle: 'Bright, bubbly and full of orange',
          art: 'orange-fizz', tint: 'lime', pattern: 'dots', stockKey: 'orange-fizz'},
      ]),
      ...section('combos', [
        {id: 'combo-snack-fizz', name: 'Snack + Fizz', rupees: 60,
          subtitle: 'Small Veggie Chips Chaat + Cola',
          art: 'combo-snack-drink', tint: 'pink', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['veggie-chips-chaat-small', 1], ['cola', 1]]},
        {id: 'combo-chaat-party', name: 'Chaat Party', rupees: 85,
          subtitle: 'Pani Puri + Bhel Puri + Lemon Fizz',
          art: 'pani-puri', tint: 'yellow', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['pani-puri', 1], ['bhel-puri', 1], ['lemon-fizz', 1]]},
        {id: 'combo-triple-dhamaka', name: 'Triple Dhamaka', rupees: 130,
          subtitle: 'Large Cheese Chips Chaat + Aloo Tikki + Cola',
          art: 'combo-triple', tint: 'lavender', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['cheese-chips-chaat-large', 1], ['aloo-tikki', 1], ['cola', 1]]},
      ]),
    ],
    addons: [
      {id: 'extra-cheese', name: 'Extra Cheese', price: rs(10)},
      {id: 'sweet-corn', name: 'Sweet Corn', price: rs(10)},
    ],
    flavours: ['Classic Salted', 'Magic Masala', 'Cream & Onion', 'Tomato Tango', 'Chilli Chatka'],
    games: [{id: 'spin-the-wheel', name: 'Spin the Wheel', fee: 0, art: 'spin-wheel'}],
    mission: ledgerMission([1500, 2500, 400, 300, 440]),
    stock: {
      'chips-small': 50, 'chips-large': 50, puris: 360, tikkis: 60, samosas: 60, kachoris: 40, fries: 40,
      cola: 24, 'lemon-fizz': 24, 'orange-fizz': 24,
    },
  };
}

/**
 * Pizza & Fizz Hub: pizza-led, with crispy sides, three fizz cans and two meal combos.
 * @returns {Menu}
 */
function snacksPizza() {
  return {
    subTagline: 'Cheesy pizza, crispy sides and ice-cold fizz cans — made fresh, served fast.',
    categories: [
      {id: 'pizza', name: 'Pizza'},
      {id: 'sides', name: 'Sides'},
      {id: 'fizz', name: 'Fizz'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('pizza', [
        {id: 'margherita-pizza-regular', name: 'Margherita Pizza · Regular', size: 'Regular', rupees: 70,
          subtitle: 'Tomato, mozzarella and oregano, 7 inch',
          art: 'cheese-pizza', tint: 'yellow', pattern: 'none', customizable: true, stockKey: 'pizza-bases'},
        {id: 'margherita-pizza-large', name: 'Margherita Pizza · Large', size: 'Large', rupees: 120,
          subtitle: 'The classic, 10 inch — made for sharing',
          art: 'cheese-pizza', tint: 'peach', pattern: 'stripes', customizable: true, stockKey: 'pizza-bases', stockUnits: 2},
        {id: 'veg-pizza', name: 'Veg Pizza', rupees: 80,
          subtitle: 'Onion, capsicum and tomato on a crisp base',
          art: 'veg-pizza', tint: 'mint', pattern: 'grid', customizable: true, stockKey: 'pizza-bases'},
        {id: 'cheese-pizza', name: 'Cheese Pizza', rupees: 90,
          subtitle: 'Stretchy, gooey, double cheese',
          art: 'cheese-pizza', tint: 'sky', pattern: 'grid', customizable: true, stockKey: 'pizza-bases'},
        {id: 'corn-cheese-pizza', name: 'Corn Cheese Pizza', rupees: 100,
          subtitle: 'Sweet corn and cheese — the crowd favourite',
          art: 'pizza', tint: 'pink', pattern: 'grid', tags: ['POP'], customizable: true, stockKey: 'pizza-bases'},
      ]),
      ...section('sides', [
        {id: 'french-fries', name: 'French Fries', rupees: 60,
          subtitle: 'Classic salted, crisp and golden',
          art: 'french-fries', tint: 'cream', pattern: 'dots', stockKey: 'fries'},
        {id: 'peri-peri-fries', name: 'Peri Peri Fries', rupees: 70,
          subtitle: 'Golden fries shaken in fiery peri peri',
          art: 'peri-peri-fries', tint: 'coral', pattern: 'zigzag', tags: ['SPICY'], stockKey: 'fries'},
        {id: 'loaded-nachos', name: 'Loaded Nachos', rupees: 90,
          subtitle: 'Cheese sauce, salsa and jalapeños — fully loaded',
          art: 'nachos', tint: 'lavender', pattern: 'stripes', tags: ['NEW'], stockKey: 'nachos'},
        {id: 'veg-burger', name: 'Veg Burger', rupees: 70,
          subtitle: 'Crispy aloo patty, lettuce and mayo in a soft bun',
          art: 'burger', tint: 'lime', pattern: 'dots', customizable: true, stockKey: 'buns'},
      ]),
      ...section('fizz', [
        {id: 'cola', name: 'Cola', rupees: 30,
          subtitle: 'Ice-cold can, extra fizzy',
          art: 'cola-can', tint: 'sky', pattern: 'dots', stockKey: 'cola'},
        {id: 'lime-soda', name: 'Lime Soda', rupees: 30,
          subtitle: 'Zingy lime-lemon can, straight from the ice box',
          art: 'lime-can', tint: 'yellow', pattern: 'dots', stockKey: 'lime-soda'},
        {id: 'orange-soda', name: 'Orange Soda', rupees: 30,
          subtitle: 'Sunny orange can, bubbly and sweet',
          art: 'orange-can', tint: 'lavender', pattern: 'dots', stockKey: 'orange-soda'},
      ]),
      ...section('combos', [
        {id: 'combo-pizza-fizz', name: 'Pizza + Fizz', rupees: 100,
          subtitle: 'Veg Pizza + Cola — lunch, sorted',
          art: 'combo-pizza-drink', tint: 'yellow', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['veg-pizza', 1], ['cola', 1]]},
        {id: 'combo-burger-meal', name: 'Burger Meal', rupees: 140,
          subtitle: 'Veg Burger + French Fries + Cola',
          art: 'combo-triple', tint: 'pink', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['veg-burger', 1], ['french-fries', 1], ['cola', 1]]},
      ]),
    ],
    addons: [
      {id: 'extra-cheese', name: 'Extra Cheese', price: rs(20)},
      {id: 'jalapenos', name: 'Jalapenos', price: rs(10)},
      {id: 'sweet-corn', name: 'Sweet Corn', price: rs(10)},
    ],
    flavours: ['Classic', 'Peri peri sprinkle', 'Chilli flakes & oregano'],
    games: [{id: 'spin-the-wheel', name: 'Spin the Wheel', fee: 0, art: 'spin-wheel'}],
    mission: ledgerMission([1500, 2800, 500, 300, 500]),
    stock: {'pizza-bases': 40, fries: 40, nachos: 25, buns: 30, cola: 24, 'lime-soda': 24, 'orange-soda': 24},
  };
}

/**
 * Chai, Coffee & Maggi Point: the late-night campus classic.
 * @returns {Menu}
 */
function chaiMaggi() {
  return {
    subTagline: 'Kulhad chai, cold coffee and Maggi made to order — fuel for the whole fest.',
    categories: [
      {id: 'chai', name: 'Chai'},
      {id: 'coffee', name: 'Coffee'},
      {id: 'maggi', name: 'Maggi'},
      {id: 'snacks', name: 'Snacks'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('chai', [
        {id: 'masala-chai', name: 'Masala Chai', rupees: 20,
          subtitle: 'Kadak, spiced and steaming hot',
          art: 'masala-chai', tint: 'peach', pattern: 'none', tags: ['BESTSELLER'], stockKey: 'paper-cups'},
        {id: 'kulhad-chai', name: 'Kulhad Chai', rupees: 30,
          subtitle: 'Served in a clay kulhad, earthy and extra kadak',
          art: 'kulhad-chai', tint: 'coral', pattern: 'zigzag', stockKey: 'kulhads'},
        {id: 'adrak-elaichi-chai', name: 'Adrak Elaichi Chai', rupees: 25,
          subtitle: 'Fresh ginger and cardamom, brewed strong',
          art: 'masala-chai', tint: 'lime', pattern: 'none', stockKey: 'paper-cups'},
      ]),
      ...section('coffee', [
        {id: 'hot-coffee', name: 'Hot Coffee', rupees: 30,
          subtitle: 'Frothy, milky and hand-beaten',
          art: 'hot-coffee', tint: 'cream', pattern: 'stripes', stockKey: 'paper-cups'},
        {id: 'cold-coffee', name: 'Cold Coffee', rupees: 60,
          subtitle: 'Thick, creamy and blended with ice',
          art: 'cold-coffee', tint: 'sky', pattern: 'dots', tags: ['CHILLED'], stockKey: 'cold-coffee'},
      ]),
      ...section('maggi', [
        {id: 'classic-maggi-half', name: 'Classic Maggi · Half', size: 'Half', rupees: 30,
          subtitle: 'One pack, hostel-style comfort',
          art: 'maggi', tint: 'yellow', pattern: 'none', customizable: true, stockKey: 'maggi-packs'},
        {id: 'classic-maggi-full', name: 'Classic Maggi · Full', size: 'Full', rupees: 50,
          subtitle: 'Two packs for the properly hungry',
          art: 'maggi', tint: 'peach', pattern: 'stripes', customizable: true, stockKey: 'maggi-packs', stockUnits: 2},
        {id: 'masala-maggi-half', name: 'Masala Maggi · Half', size: 'Half', rupees: 40,
          subtitle: 'Loaded with veggies and extra masala',
          art: 'maggi', tint: 'pink', pattern: 'none', customizable: true, stockKey: 'maggi-packs'},
        {id: 'masala-maggi-full', name: 'Masala Maggi · Full', size: 'Full', rupees: 70,
          subtitle: 'Double pack, double veggies, double masala',
          art: 'maggi', tint: 'coral', pattern: 'stripes', customizable: true, stockKey: 'maggi-packs', stockUnits: 2},
        {id: 'cheese-maggi', name: 'Cheese Maggi', rupees: 80,
          subtitle: 'Full plate, smothered in melty cheese',
          art: 'maggi', tint: 'lavender', pattern: 'grid', tags: ['NEW'], customizable: true, stockKey: 'maggi-packs', stockUnits: 2},
      ]),
      ...section('snacks', [
        {id: 'samosa', name: 'Samosa', rupees: 20,
          subtitle: 'Crisp, spicy aloo filling + green chutney',
          art: 'samosa', tint: 'lime', pattern: 'zigzag', stockKey: 'samosas'},
        {id: 'grilled-sandwich', name: 'Grilled Sandwich', rupees: 60,
          subtitle: 'Veggies, butter and cheese, toasted golden',
          art: 'grilled-sandwich', tint: 'cream', pattern: 'grid', customizable: true, stockKey: 'sandwiches'},
        {id: 'aloo-tikki', name: 'Aloo Tikki', rupees: 40,
          subtitle: '2 crispy tikkis with chutneys',
          art: 'aloo-tikki', tint: 'coral', pattern: 'dots', stockKey: 'tikkis', stockUnits: 2},
      ]),
      ...section('combos', [
        {id: 'combo-chai-samosa', name: 'Chai + Samosa', rupees: 35,
          subtitle: 'Masala Chai + Samosa — the OG pairing',
          art: 'samosa', tint: 'pink', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['masala-chai', 1], ['samosa', 1]]},
        {id: 'combo-maggi-cold-coffee', name: 'Maggi + Cold Coffee', rupees: 90,
          subtitle: 'Masala Maggi (Half) + Cold Coffee',
          art: 'maggi', tint: 'mint', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['masala-maggi-half', 1], ['cold-coffee', 1]]},
      ]),
    ],
    addons: [
      {id: 'extra-cheese', name: 'Extra Cheese', price: rs(20)},
      {id: 'butter', name: 'Butter', price: rs(10)},
      {id: 'extra-veggies', name: 'Extra Veggies', price: rs(10)},
    ],
    flavours: ['Regular', 'Extra spicy', 'Less spicy'],
    games: [],
    mission: ledgerMission([1500, 1800, 500, 300, 400]),
    stock: {'paper-cups': 200, kulhads: 100, 'cold-coffee': 40, 'maggi-packs': 60, samosas: 60, sandwiches: 30, tikkis: 80},
  };
}

/**
 * Momo & Fast-Food Corner: momos by the plate, burgers and rolls, desi mains and coolers. Piece-counted stock.
 * (Successor of the retired 'chaat-momo' template, which now builds this one.)
 * @returns {Menu}
 */
function momoCorner() {
  return {
    subTagline: 'Steamed and fried momos, burgers, frankies and pav bhaji — served hot and fast.',
    categories: [
      {id: 'momos', name: 'Momos'},
      {id: 'fast-food', name: 'Fast Food'},
      {id: 'desi-mains', name: 'Desi Mains'},
      {id: 'drinks', name: 'Drinks'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('momos', [
        {id: 'steamed-veg-momos-half', name: 'Steamed Veg Momos · Half', size: 'Half', rupees: 50,
          subtitle: '5 pcs with fiery red chutney',
          art: 'steamed-momos', tint: 'mint', pattern: 'none', tags: ['BESTSELLER'], stockKey: 'momos', stockUnits: 5},
        {id: 'steamed-veg-momos-full', name: 'Steamed Veg Momos · Full', size: 'Full', rupees: 90,
          subtitle: '10 pcs with fiery red chutney',
          art: 'steamed-momos', tint: 'sky', pattern: 'grid', stockKey: 'momos', stockUnits: 10},
        {id: 'fried-momos-half', name: 'Fried Momos · Half', size: 'Half', rupees: 60,
          subtitle: '5 pcs, golden-fried and tossed in hot chutney',
          art: 'fried-momos', tint: 'peach', pattern: 'zigzag', tags: ['SPICY'], stockKey: 'momos', stockUnits: 5},
        {id: 'fried-momos-full', name: 'Fried Momos · Full', size: 'Full', rupees: 110,
          subtitle: '10 pcs of crunchy, saucy goodness',
          art: 'fried-momos', tint: 'coral', pattern: 'zigzag', stockKey: 'momos', stockUnits: 10},
      ]),
      ...section('fast-food', [
        {id: 'veg-burger', name: 'Veg Burger', rupees: 70,
          subtitle: 'Crispy aloo patty, lettuce and mayo in a soft bun',
          art: 'burger', tint: 'yellow', pattern: 'dots', customizable: true, stockKey: 'buns'},
        {id: 'veg-frankie', name: 'Veg Frankie', rupees: 60,
          subtitle: 'Spiced aloo roll with onion and chutney',
          art: 'frankie-roll', tint: 'lavender', pattern: 'stripes', customizable: true, stockKey: 'wraps'},
        {id: 'grilled-sandwich', name: 'Grilled Sandwich', rupees: 60,
          subtitle: 'Veggies, butter and cheese, toasted golden',
          art: 'grilled-sandwich', tint: 'cream', pattern: 'grid', customizable: true, stockKey: 'sandwiches'},
      ]),
      ...section('desi-mains', [
        {id: 'pav-bhaji', name: 'Pav Bhaji', rupees: 80,
          subtitle: 'Buttery bhaji with 2 toasted pav',
          art: 'pav-bhaji', tint: 'coral', pattern: 'dots', customizable: true, stockKey: 'pav', stockUnits: 2},
        {id: 'chole-bhature', name: 'Chole Bhature', rupees: 100,
          subtitle: '2 fluffy bhature with spicy chole',
          art: 'chole-bhature', tint: 'yellow', pattern: 'grid', stockKey: 'bhature', stockUnits: 2},
      ]),
      ...section('drinks', [
        {id: 'mint-mojito', name: 'Mint Mojito', rupees: 50,
          subtitle: 'Virgin, minty and ice-cold',
          art: 'mint-mojito', tint: 'sky', pattern: 'stripes', tags: ['CHILLED']},
        {id: 'cola', name: 'Cola', rupees: 30,
          subtitle: 'Ice-cold can, extra fizzy',
          art: 'cola-can', tint: 'lime', pattern: 'dots', stockKey: 'cola'},
      ]),
      ...section('combos', [
        {id: 'combo-momo-mojito', name: 'Momo + Mojito', rupees: 90,
          subtitle: 'Steamed Veg Momos (Half) + Mint Mojito',
          art: 'steamed-momos', tint: 'pink', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['steamed-veg-momos-half', 1], ['mint-mojito', 1]]},
        {id: 'combo-burger-cola', name: 'Burger + Cola', rupees: 85,
          subtitle: 'Veg Burger + Cola — quick bite, sorted',
          art: 'combo-snack-drink', tint: 'yellow', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['veg-burger', 1], ['cola', 1]]},
      ]),
    ],
    addons: [
      {id: 'extra-cheese', name: 'Extra Cheese', price: rs(20)},
      {id: 'extra-mayo', name: 'Extra Mayo', price: rs(10)},
      {id: 'extra-butter', name: 'Extra Butter', price: rs(10)},
    ],
    flavours: ['Medium spicy', 'Extra teekha', 'Less spicy'],
    games: [],
    mission: ledgerMission([1500, 2200, 500, 300, 500]),
    stock: {momos: 300, buns: 40, wraps: 40, sandwiches: 30, pav: 80, bhature: 60, cola: 24},
  };
}

/**
 * Sweet Tooth & Dessert Bar: desserts, thick shakes, lassi and cold coffee.
 * @returns {Menu}
 */
function sweetTooth() {
  return {
    subTagline: 'Brownie sundaes, kulfi, gulab jamun and thick shakes — dessert first, always.',
    categories: [
      {id: 'desserts', name: 'Desserts'},
      {id: 'shakes', name: 'Shakes'},
      {id: 'lassi-cold-coffee', name: 'Lassi & Cold Coffee'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('desserts', [
        {id: 'brownie-sundae', name: 'Brownie Sundae', rupees: 90,
          subtitle: 'Warm brownie, ice cream and choco sauce',
          art: 'brownie-sundae', tint: 'pink', pattern: 'zigzag', tags: ['POP'], customizable: true, stockKey: 'brownies'},
        {id: 'gulab-jamun', name: 'Gulab Jamun', rupees: 30,
          subtitle: '2 warm jamuns in rose syrup',
          art: 'gulab-jamun', tint: 'coral', pattern: 'none', stockKey: 'gulab-jamuns', stockUnits: 2},
        {id: 'malai-kulfi', name: 'Malai Kulfi', rupees: 40,
          subtitle: 'Creamy malai kulfi on a stick',
          art: 'kulfi', tint: 'sky', pattern: 'grid', tags: ['CHILLED'], stockKey: 'kulfi'},
        {id: 'kesar-pista-kulfi', name: 'Kesar Pista Kulfi', rupees: 50,
          subtitle: 'Saffron and pistachio, slow-set and rich',
          art: 'kulfi', tint: 'yellow', pattern: 'grid', tags: ['NEW'], stockKey: 'kulfi'},
      ]),
      ...section('shakes', [
        {id: 'chocolate-milkshake-regular', name: 'Chocolate Milkshake · Regular', size: 'Regular', rupees: 60,
          subtitle: 'Thick, chocolatey, blended to order',
          art: 'milkshake', tint: 'lavender', pattern: 'none', customizable: true},
        {id: 'chocolate-milkshake-large', name: 'Chocolate Milkshake · Large', size: 'Large', rupees: 80,
          subtitle: 'Tall glass, extra chocolatey',
          art: 'milkshake', tint: 'pink', pattern: 'stripes', customizable: true},
        {id: 'strawberry-shake', name: 'Strawberry Shake', rupees: 60,
          subtitle: 'Pink, creamy and berry-sweet',
          art: 'milkshake', tint: 'peach', pattern: 'dots', customizable: true},
      ]),
      ...section('lassi-cold-coffee', [
        {id: 'mango-lassi', name: 'Mango Lassi', rupees: 50,
          subtitle: 'Ripe mango and curd, thick and chilled',
          art: 'lassi', tint: 'yellow', pattern: 'dots'},
        {id: 'sweet-lassi', name: 'Sweet Lassi', rupees: 40,
          subtitle: 'Punjabi-style, topped with malai',
          art: 'lassi', tint: 'cream', pattern: 'zigzag'},
        {id: 'cold-coffee-regular', name: 'Cold Coffee · Regular', size: 'Regular', rupees: 50,
          subtitle: 'Creamy, chilled, with a caffeine kick',
          art: 'cold-coffee', tint: 'mint', pattern: 'none', customizable: true},
        {id: 'cold-coffee-large', name: 'Cold Coffee · Large', size: 'Large', rupees: 70,
          subtitle: 'Tall glass for the all-nighters',
          art: 'cold-coffee', tint: 'sky', pattern: 'stripes', customizable: true},
      ]),
      ...section('combos', [
        {id: 'combo-shake-brownie', name: 'Shake + Brownie', rupees: 130,
          subtitle: 'Chocolate Milkshake (Regular) + Brownie Sundae',
          art: 'brownie-sundae', tint: 'yellow', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['chocolate-milkshake-regular', 1], ['brownie-sundae', 1]]},
        {id: 'combo-desi-sweet-duo', name: 'Desi Sweet Duo', rupees: 60,
          subtitle: 'Gulab Jamun + Malai Kulfi',
          art: 'gulab-jamun', tint: 'lavender', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['gulab-jamun', 1], ['malai-kulfi', 1]]},
      ]),
    ],
    addons: [
      {id: 'ice-cream-scoop', name: 'Ice Cream Scoop', price: rs(20)},
      {id: 'choco-chips', name: 'Choco Chips', price: rs(10)},
      {id: 'chocolate-sauce', name: 'Chocolate Sauce', price: rs(10)},
    ],
    flavours: [],
    games: [],
    mission: ledgerMission([1500, 2400, 400, 400, 400]),
    stock: {brownies: 30, kulfi: 60, 'gulab-jamuns': 60},
  };
}

/**
 * Mela Games & Lucky Zone: four paid stall games plus coolers, shakes and desserts.
 * @returns {Menu}
 */
function drinksGames() {
  return {
    subTagline: 'Chilled coolers, thick shakes and mela games for the whole gang.',
    categories: [
      {id: 'fizz-coolers', name: 'Fizz & Coolers'},
      {id: 'shakes', name: 'Shakes'},
      {id: 'desserts', name: 'Desserts'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [
      ...section('fizz-coolers', [
        {id: 'cola', name: 'Cola', rupees: 30,
          subtitle: 'Ice-cold and extra fizzy',
          art: 'cola-can', tint: 'sky', pattern: 'dots', stockKey: 'cola'},
        {id: 'lemon-fizz', name: 'Lemon Fizz', rupees: 30,
          subtitle: 'Zesty lemon-lime bubbles',
          art: 'lemon-fizz', tint: 'peach', pattern: 'dots', stockKey: 'lemon-fizz'},
        {id: 'orange-fizz', name: 'Orange Fizz', rupees: 30,
          subtitle: 'Bright, bubbly and full of orange',
          art: 'orange-fizz', tint: 'lime', pattern: 'dots', stockKey: 'orange-fizz'},
        {id: 'masala-shikanji', name: 'Masala Shikanji', rupees: 40,
          subtitle: 'Desi lemonade with jeera and kala namak',
          art: 'lemon', tint: 'yellow', pattern: 'zigzag', tags: ['NEW']},
        {id: 'mint-mojito', name: 'Mint Mojito', rupees: 60,
          subtitle: 'Virgin mojito, crushed ice, lots of mint',
          art: 'mint-mojito', tint: 'sky', pattern: 'stripes', tags: ['BESTSELLER']},
      ]),
      ...section('shakes', [
        {id: 'chocolate-milkshake-regular', name: 'Chocolate Milkshake · Regular', size: 'Regular', rupees: 60,
          subtitle: 'Thick, chocolatey, blended to order',
          art: 'milkshake', tint: 'lavender', pattern: 'none', customizable: true},
        {id: 'chocolate-milkshake-large', name: 'Chocolate Milkshake · Large', size: 'Large', rupees: 80,
          subtitle: 'Tall glass, extra chocolatey',
          art: 'milkshake', tint: 'pink', pattern: 'stripes', customizable: true},
        {id: 'mango-lassi', name: 'Mango Lassi', rupees: 50,
          subtitle: 'Ripe mango and curd, thick and chilled',
          art: 'lassi', tint: 'yellow', pattern: 'dots'},
        {id: 'cold-coffee-regular', name: 'Cold Coffee · Regular', size: 'Regular', rupees: 50,
          subtitle: 'Creamy, chilled, with a caffeine kick',
          art: 'cold-coffee', tint: 'cream', pattern: 'none', customizable: true},
        {id: 'cold-coffee-large', name: 'Cold Coffee · Large', size: 'Large', rupees: 70,
          subtitle: 'Tall glass for the all-nighters',
          art: 'cold-coffee', tint: 'peach', pattern: 'stripes', customizable: true},
      ]),
      ...section('desserts', [
        {id: 'brownie-sundae', name: 'Brownie Sundae', rupees: 90,
          subtitle: 'Warm brownie, ice cream and choco sauce',
          art: 'brownie-sundae', tint: 'pink', pattern: 'zigzag', tags: ['POP'], customizable: true, stockKey: 'brownies'},
        {id: 'kulfi', name: 'Kulfi', rupees: 40,
          subtitle: 'Creamy malai kulfi on a stick',
          art: 'kulfi', tint: 'sky', pattern: 'grid', tags: ['CHILLED'], stockKey: 'kulfi'},
      ]),
      ...section('combos', [
        {id: 'combo-shake-brownie', name: 'Shake + Brownie', rupees: 130,
          subtitle: 'Chocolate Milkshake (Regular) + Brownie Sundae',
          art: 'brownie-sundae', tint: 'yellow', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['chocolate-milkshake-regular', 1], ['brownie-sundae', 1]]},
        {id: 'combo-mojito-duo', name: 'Mojito Duo', rupees: 110,
          subtitle: '2 Mint Mojitos — bring a friend',
          art: 'mint-mojito', tint: 'lavender', pattern: 'sunburst', tags: ['COMBO'],
          bundle: [['mint-mojito', 2]]},
      ]),
    ],
    addons: [
      {id: 'ice-cream-scoop', name: 'Ice Cream Scoop', price: rs(20)},
      {id: 'choco-chips', name: 'Choco Chips', price: rs(10)},
      {id: 'chocolate-sauce', name: 'Chocolate Sauce', price: rs(10)},
    ],
    flavours: [],
    games: [
      {id: 'ring-toss', name: 'Ring Toss', fee: rs(20), art: 'ring-toss'},
      {id: 'spin-the-wheel', name: 'Spin the Wheel', fee: rs(30), art: 'spin-wheel'},
      {id: 'dart-game', name: 'Dart Game', fee: rs(20), art: 'dart-game'},
      {id: 'lucky-cup', name: 'Lucky Cup', fee: rs(10), art: 'lucky-cup'},
    ],
    mission: ledgerMission([1500, 2000, 400, 600, 500]),
    stock: {cola: 48, 'lemon-fizz': 48, 'orange-fizz': 48, brownies: 30, kulfi: 40},
  };
}

/**
 * Blank stall: three empty categories; discounts, bill suggestions and milestones ready to fill in.
 * @returns {Menu}
 */
function blank() {
  return {
    subTagline: 'Good food, fast orders and a fest to remember.',
    categories: [
      {id: 'snacks', name: 'Snacks'},
      {id: 'drinks', name: 'Drinks'},
      {id: 'combos', name: 'Combos'},
    ],
    products: [],
    addons: [],
    flavours: [],
    games: [],
    mission: ledgerMission([0, 0, 0, 0, 0]),
    stock: {},
  };
}

/** Menu builders by template id (a Map, so ids like "constructor" can never resolve). @type {ReadonlyMap<string, () => Menu>} */
const MENUS = new Map([
  ['street-chaat', streetChaat],
  ['snacks-pizza', snacksPizza],
  ['chai-maggi', chaiMaggi],
  ['momo-corner', momoCorner],
  ['sweet-tooth', sweetTooth],
  ['drinks-games', drinksGames],
  ['blank', blank],
]);
