# ManageYourStall (MYS) — Architecture Contract

> **This document is the contract every contributor (human or agent) builds against.**
> If code and this document disagree, fix the code — or, if the document is wrong, change the document
> in the same change and say why. Brand: **ManageYourStall**, short mark **MYS**, permanent credit **"created by viraj"**.

MYS is a universal, offline-first point-of-sale and stall command center for temporary food/game stalls at Indian college fests,
Diwali melas, flea markets and pop-ups. It evolved from a single-stall app ("Packet Pataka · Stall No. 10"); every hardcoded stall
detail is now owner-editable data.

---

## 0. Ground rules

1. **No build step, no runtime dependencies, no CDN.** `dist/` is deployed as-is (Vercel `outputDirectory: dist`). Native ES modules
   (`.mjs`), plain CSS, inline SVG. Dev dependencies are for tests only (`@playwright/test`, `fake-indexeddb`, `jsqr`, `typescript`).
2. **Offline-first.** The service worker precaches every file in `dist/`. Nothing may require the network except: an owner-pasted
   https image URL (falls back to library art offline) and the WhatsApp share link.
3. **Money is integer paise** everywhere (`₹1 = 100`). Parse human input with `paise()`, format with `money()`. Never use floats for
   money. Percent discounts round with `Math.round` to the nearest paise.
4. **Time:** store ISO-8601 UTC strings (`new Date().toISOString()`); display and group by **India time** (`Asia/Kolkata`) using
   `util.mjs` helpers (`istDate`, `istHour`, `istStamp`).
5. **Pure vs UI:** `util`, `constants`, `catalog`, `domain`, `templates`, `qr`, `library`, `art/*` are **pure** (no DOM, no storage,
   deterministic given inputs, `// @ts-check` + JSDoc, covered by `npm run typecheck`). Everything under `dist/ui/` is UI.
6. **Readable source.** Normal formatting (one statement per line, 2-space indent, ≤ ~140 cols). No minified code. JSDoc on exported
   functions.
7. **File ownership.** Each file has exactly one owner per wave (§1). Do not edit files you do not own. If you need a change elsewhere,
   describe it precisely in your final report instead.
8. **Neo-Brutalist design** (§12) for every screen, sheet and widget.
9. **Zero regressions:** everything the v1 app did still works (§15 lists the v1 feature inventory).

Commands: `npm start` (http://127.0.0.1:4173) · `npm run verify` (= `check` + `typecheck` + `test`) · `npm run test:browser`.

---

## 1. File map & ownership

| Path | Kind | Owner |
|---|---|---|
| `dist/util.mjs` | money/paise/uuid/esc/IST helpers | lead (done) |
| `dist/constants.mjs` | shared vocabulary & regexes | lead (done) |
| `dist/library.mjs` | visual library registry (`artSvg`, `ART_LIST`, `searchArt`) | lead (done) |
| `dist/art/classic.mjs` | 6 legacy illustrations (`packet corn pizza lemon masala cold`) | lead (done) |
| `dist/art/snacks.mjs` · `mains.mjs` · `drinks.mjs` · `sweets.mjs` | illustration batches | art agents (one each) |
| `dist/catalog.mjs` | config (menu/settings) helpers + `validateConfig` + `missionTarget` + `autoMilestones` | catalog agent |
| `dist/domain.mjs` | ledger: lines, totals, discounts, orders, payments, split, refunds, tokens, kitchen, games, expenses, reports, milestones, UPI URI, day report, CSV rows, migration, backup validation, `initialState`, `applyTemplate` | domain agent |
| `dist/templates.mjs` | stall starter templates (pure data) | templates agent |
| `dist/qr.mjs` | QR encoder + SVG renderer | QR agent |
| `dist/storage.mjs` | IndexedDB adapter (state + media stores) | core agent |
| `dist/icons.mjs` | UI line icons | core agent |
| `dist/ui/core.mjs` | UI kernel (§9) | core agent |
| `dist/ui/shell.mjs` | layout, brand, nav, operator switcher (§10) | core agent |
| `dist/app.mjs` | bootstrap: imports every UI module, boots | core agent |
| `dist/index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png` | shell files | core agent |
| `dist/css/base.css` | design system (§12) | core agent |
| `dist/ui/sell.mjs` + `dist/css/sell.css` | Sell screen | sell agent |
| `dist/ui/checkout.mjs` + `dist/css/checkout.css` | Review & pay, UPI QR, cash change, success | checkout agent |
| `dist/ui/orders.mjs` + `dist/css/orders.css` | Orders, kitchen queue, receipts, corrections | orders agent |
| `dist/ui/dashboard.mjs`, `dist/ui/milestones.mjs` + `dist/css/dashboard.css` | Dashboard, mission, day report/WhatsApp, milestones | dashboard agent |
| `dist/ui/menu.mjs` + `dist/css/menu.css` | Menu manager, price board, combos, add-ons, stock | menu agent |
| `dist/ui/picker.mjs` + `dist/css/picker.css` | Visual picker modal (library/upload/URL/style) | picker agent |
| `dist/ui/studio.mjs`, `dist/ui/onboarding.mjs` + `dist/css/studio.css` | Stall Studio, templates switcher, onboarding | studio agent |
| `dist/ui/more.mjs`, `dist/ui/games.mjs`, `dist/ui/data.mjs` + `dist/css/more.css` | More hub, game corner, expenses, backups/exports/resets, practice/live, PIN, install | more agent |
| `tests/<module>.test.mjs` | node:test unit tests | the module's owner |
| `tests/browser/*.spec.mjs` | Playwright specs | owner named in the file name |
| `scripts/check.mjs`, `server.mjs`, `tsconfig.json`, `package.json` | tooling | lead |

`dist/art.mjs` and `dist/style.css` (v1) are deleted by the core agent. The core agent creates **stub** versions of every wave-2 UI
module and CSS file so the app boots before wave 2 replaces them.

---

## 2. Data model (schema v2)

All objects are plain JSON (structured-clone safe). `id` strings match `ID_RE` (`/^[a-zA-Z0-9_-]{1,100}$/`).

```ts
type Paise = number;            // safe integer
type ISO = string;              // new Date().toISOString()

interface State {
  version: 2;
  revision: number;             // +1 on every committed write
  mode: 'live' | 'demo';        // demo = "Practice counter" (separate ledger, shared config)
  onboarded: boolean;           // false → onboarding opens on boot
  pin: null | { salt: string; hash: string };   // SHA-256(salt + ':' + pin) hex (64 chars)
  config: Config;
  live: Session;
  demo: Session;
}

interface Config {
  schema: 2;
  templateId: string;           // template the menu came from ('legacy' for migrated v1 data)
  profile: {
    stallName: string;          // "My Awesome Stall"
    booth: string;              // "Stall No. 10" / "Booth B-12" (free text)
    tagline: string;            // hero line on Sell, e.g. "Little packets. Big pataka energy."
    subTagline: string;         // hero sub-line
    eventName: string;          // "Diwali Celebration"
    venue: string;              // "Baderia Global Institute"
    city: string;               // "Jabalpur"
    eventDate: string;          // 'YYYY-MM-DD' or ''
    ownerName: string;          // team / owner name
    initials: string;           // ≤3 chars avatar text; '' → derived via initialsOf(ownerName)
  };
  theme: { accent: string };    // '#RRGGBB', drives CSS --accent
  upi: { id: string; payeeName: string };       // id '' = UPI QR disabled; payeeName '' → stallName
  operator: string;             // current cashier name (stamped on records)
  operators: string[];          // team list (≥1)
  kitchenQueue: boolean;        // true → new orders start 'preparing'; false → start 'handed'
  allowCustomDiscount: boolean; // show "Custom ₹/% off" chip at checkout
  inventory: boolean;           // stock tracking on/off
  stock: Record<string, number>;// stock pool key → total units stocked (incl. used)
  categories: Category[];       // display order
  products: Product[];          // display order (global; grouped by category when shown)
  addons: { id: string; name: string; price: Paise }[];   // optional extras for customizable items
  flavours: string[];           // optional flavour/variant picks for customizable items (may be empty)
  games: Game[];
  discounts: DiscountRule[];    // 1-tap checkout chips, display order
  mission: Mission;
  milestones: Milestone[];      // display order
}

interface Category { id: string; name: string }          // name ≤30, unique (case-insensitive)

interface Product {
  id: string;
  name: string;                 // ≤50
  subtitle: string;             // ≤80, '' allowed
  categoryId: string;           // must exist in config.categories
  size: string;                 // ≤20 variant label: Small/Large/Half/Full/Regular/Combo… or ''
  price: Paise | null;          // null = "price not set" (stall setup mode): visible but NOT sellable
  priceLocked: boolean;         // true = price protected; quick/batch edits refuse to change it until unlocked
  art: string;                  // library id (library.mjs); used when image is null or fails to load
  image: string | null;         // null | 'media:<id>' (IndexedDB media store) | 'https://…' (≤2000 chars)
  tint: string;                 // TINT_IDS
  pattern: string;              // PATTERN_IDS
  tags: string[];               // subset of TAG_IDS, unique
  active: boolean;              // false = hidden from the Sell menu (kept in Menu manager)
  soldOut: boolean;             // 1-tap temporary disable
  customizable: boolean;        // tap opens customize sheet (flavours/add-ons/qty/note)
  stockKey: string;             // '' = untracked, else key in config.stock
  stockUnits: number;           // ≥1 units consumed per item sold
  bundle: null | { productId: string; quantity: number }[];  // combo: components (non-bundle products), price is the combo price
}

interface Game { id: string; name: string; fee: Paise; art: string }   // fee 0 = free
interface DiscountRule {
  id: string; label: string;    // "Reel story? ₹10 off"
  type: 'flat' | 'percent';
  value: number;                // flat: Paise ≥1; percent: integer 1–100
  minimum: Paise;               // 0 = no minimum subtotal
  active: boolean;              // inactive rules are hidden at checkout
}
interface Mission {
  mode: 'total' | 'itemized';
  total: Paise;                 // used when mode === 'total'
  items: { id: string; label: string; amount: Paise }[];   // used when mode === 'itemized' (amount ≥0)
}
interface Milestone {
  id: string; title: string;    // ≤40
  type: 'orders' | 'revenue' | 'recovery' | 'items' | 'games';
  target: number;               // orders/items/games: count ≥1; revenue: Paise ≥1; recovery: percent 1–1000
}

interface Session {             // one per mode
  started: boolean;
  orders: Order[];
  payments: Payment[];          // the money ledger (source of truth for collections)
  games: GamePlay[];
  expenses: Expense[];          // extra costs recorded during the event (raise the break-even target)
  audit: AuditEntry[];
  milestones: Record<string, { active: boolean; unlockedAt: ISO | null; reference: string | null; updatedAt: ISO }>;
  draft: Line[];                // current cart (persisted, survives reload)
  draftId: string;              // idempotency key for the next order
  draftDiscount: null | { ruleId: string } | { custom: true; type: 'flat' | 'percent'; value: number };
  draftNote: string;            // order note ("extra spicy, no onion"), ≤200
  tokenDay: string | null;      // IST 'YYYY-MM-DD' of the current token sequence
  tokenSeq: number;             // last token issued on tokenDay
}

interface Line {                // immutable price snapshot once added to the cart
  id: string; productId: string; name: string; category: string /* category NAME snapshot */; size: string;
  flavour: string; addons: { id: string; name: string; price: Paise }[];
  quantity: number;             // 1–999
  unitPrice: Paise; lineTotal: Paise;   // lineTotal === unitPrice * quantity
  stock: Record<string, number>;// units per 1 quantity, by stock key
  bundle: null | { productId: string; quantity: number }[];
  note: string;                 // per-line note ('' default)
}

interface Order {
  id: string;                   // = the draftId used at checkout (idempotent)
  number: number;               // 1-based sequence within the session
  token: number | null;         // daily kitchen token (null only for migrated v1 orders)
  tokenDay: string | null;      // IST day the token belongs to
  at: ISO; operator: string;
  items: Line[];
  subtotal: Paise; discount: Paise; total: Paise;       // total = subtotal − discount
  discountInfo: null | { id: string | null; label: string; type: 'flat' | 'percent'; value: number };
  note: string;
  method: 'Cash' | 'UPI' | 'Split' | 'Other';
  split: null | { Cash: Paise; UPI: Paise };            // null unless method is 'Split'; a pending Split order may keep null until
                                                        // markPaid supplies the parts; when set, both > 0 and sum = total
  status: 'paid' | 'partial' | 'refunded' | 'void' | 'pending';
  kitchen: 'preparing' | 'ready' | 'handed';
  kitchenAt: { preparing?: ISO; ready?: ISO; handed?: ISO };
  cashReceived: Paise | null;   // Cash: tendered amount; Split: tendered for the cash part
  change: Paise;                // money handed back
}

interface Payment {             // ledger row; method is always concrete
  id: string; entityId: string /* order or game play id */;
  kind: 'order' | 'game' | 'refund';
  amount: Paise;                // negative for refunds
  method: 'Cash' | 'UPI' | 'Other';
  at: ISO;
}
interface GamePlay { id: string; gameId: string; name: string; fee: Paise; prize: string; method: 'Cash' | 'UPI' | 'Other'; operator: string; at: ISO; void: boolean }
interface Expense { id: string; category: string; amount: Paise; description: string; at: ISO; operator: string }
interface AuditEntry { id: string; type: string; entityId: string; operator: string; details: object; at: ISO }
```

**Invariants** (enforced by `validateBackup`, relied on everywhere):
- Collections = Σ payments. An order's *net* = Σ its payments. `paid` ⇒ net = total; `partial` ⇒ 0 < net < total;
  `refunded | void | pending` ⇒ net = 0. Game play net = fee unless void (then 0).
- A Split order's payments: one Cash + one UPI row at creation (amounts = split parts). Refunds are per method and never exceed
  that method's net for the entity.
- Line snapshots never change after the line is added to the cart; menu edits never alter history.
- Pending orders reserve stock but add no collections. Void releases stock; refunds do **not** return prepared food to stock.

---

## 3. `domain.mjs` (ledger & reports) — pure

Imports: `util.mjs`, `constants.mjs`, `catalog.mjs` (`validateConfig`, `missionTarget`), `templates.mjs` (`buildTemplate`).
`now` parameters default to `new Date().toISOString()`. All functions throw `Error` with a short, human, actionable message on
invalid input (shown directly to cashiers).

```js
// state
initialState({templateId = 'snacks-pizza', withPrices = true} = {}) → State   // onboarded:false, mode 'live', profile defaults §5
session() → Session
migrate(state) → State                     // idempotent; v1 → v2 (§14); v2 passes through (fills any missing optional fields)
applyTemplate(state, templateId, {withPrices = true} = {}, now) → void
  // replaces config.categories/products/addons/flavours/games/discounts/allowCustomDiscount/mission/milestones/stock/inventory/
  // kitchenQueue/templateId with the template's; keeps profile (except fills tagline/subTagline only if they are ''), theme, upi,
  // operators, pin, sessions' history. Clears both sessions' drafts (+ draftDiscount/draftNote, new draftId). Audits
  // 'template-applied' in the current session. Refreshes milestones for both sessions.

// catalog lookups used by the ledger
productById(c, id) → Product | undefined
sellability(s, c, product) → { ok: boolean, reason: '' | 'hidden' | 'soldout' | 'unpriced' | 'stock' | 'component', left: number | null }
  // 'stock' only when c.inventory and the item's pool can't cover stockUnits; left = remaining units of its pool (or null).
  // Combos: left = min over pools of floor(remaining / units per combo); 'component' when a component is missing or sold out
  // (a hidden — active:false — component does NOT block a combo: owners may sell an item only inside combos).
unitPrice(product, c, addonIds = []) → Paise | null      // bundle → its own price; else price + chosen add-on prices; null if unpriced
stockUsed(s) → Record<key, number>                      // non-void orders (pending included)
stockLeft(s, c, key) → number | null                     // null when untracked

// cart (all mutate the given session)
makeLine(c, productId, {quantity = 1, addons = [], flavour = '', note = ''} = {}) → Line     // validates sellable (ignores stock)
addToDraft(s, c, line) → Line          // merges with an identical line (same productId, unitPrice, flavour, addon ids, note)
setLineQuantity(s, lineId, quantity)   // 0 removes; max 999
removeLine(s, lineId)
clearDraft(s)                          // empties cart, discount, note; new draftId
setDraftDiscount(s, c, spec | null)    // validates spec against c (rule exists & active, or custom allowed & valid)
setDraftNote(s, text)                  // trims, ≤200

// discounts & totals
resolveDiscount(c, spec) → null | { id: string | null, label, type, value, minimum }
  // custom labels: "Custom ₹20 off" / "Custom 10% off"
totals(lines, rule = null) → { subtotal, discount, total, discountInfo, minimumShort }
  // discount = 0 when subtotal < rule.minimum (then minimumShort = minimum − subtotal, else 0)
  // flat: min(value, subtotal); percent: Math.round(subtotal * value / 100), capped at subtotal

// orders
createOrder(s, c, {id, items, discount = null, note = '', method = 'Cash', split = null, pending = false, cashReceived = null}, now) → Order
  // Idempotent on id (returns the existing order). Validates every item still sellable (incl. stock when c.inventory),
  // method ∈ CHECKOUT_METHODS, split parts, cashReceived ≥ cash due. Assigns number, token (daily IST sequence; resets when the
  // IST day changes), kitchen ('preparing' if c.kitchenQueue else 'handed'). Writes payments unless pending. Clears the draft.
  // Audits 'order-created'. Refreshes milestones.
markPaid(s, c, id, {method, split = null, cashReceived = null}, now)    // pending → paid; writes payment row(s); audit 'payment-confirmed'
correctOrder(s, c, id, {type: 'void' | 'refund', amount = 0, reason, method = null}, now)
  // refund: amount ≥1 from one method (method required for Split orders, defaults to the order method otherwise), ≤ that method's
  // net. void: reverses every method's remaining net (one refund row per method) and voids the order (releases stock).
  // Pending orders can only be voided. Status → 'void' | 'refunded' (net 0) | 'partial'. Audit type = 'void' | 'refund'.
methodBalances(s, entityId) → { Cash, UPI, Other }
netFor(s, entityId) → Paise
setKitchen(s, c, id, status, now)          // any KITCHEN_STATUSES transition (incl. undo); not for void/refunded orders
kitchenQueue(s) → { preparing: Order[], ready: Order[] }   // excludes void/refunded/handed; oldest first; pending included
resetTokens(s, c, now)                     // tokenSeq = 0, tokenDay = today; audit 'tokens-reset'
upcomingToken(s, now) → number             // the token the next order would get at `now` (for the UPI note before createOrder)
draftTotals(s, c) → totals(s.draft, resolveDiscount(c, s.draftDiscount))   // cart totals for Sell/Checkout
audit(s, type, entityId, operator, details = {}, now) → AuditEntry          // append an audit row (resets, menu edits…)
// also re-exported for convenience: uuid, money, paise, integer (from util.mjs)

// games & expenses
addGame(s, c, {id, gameId, prize = '', method = 'Cash'}, now)          // idempotent on id; free games write no payment
voidGame(s, c, id, reason, now)
addExpense(s, c, {id, category, amount, description}, now)              // idempotent on id; amount ≥1; audit 'expense-recorded'

// reporting
report(s, c, {day = null} = {}) → Report     // day 'YYYY-MM-DD' scopes sales metrics to that IST day; mission is always whole-session
refreshMilestones(s, c, now) → Record<id, boolean>     // evaluates c.milestones against report(s, c); keeps first unlockedAt
milestoneProgress(m, r) → { value, goal, ratio /*0..1*/, done, valueLabel, goalLabel }   // labels formatted (₹ for revenue, % for recovery)
upiUri(c, amount, note = '') → string | null   // null when c.upi.id is ''; throws when amount < 1 paise. Exactly:
  // `upi://pay?pa=${enc(id)}&pn=${enc(payeeName || stallName)}&am=${(amount/100).toFixed(2)}&cu=INR` + (note ? `&tn=${enc(note)}` : '')
dayReportText(s, c, {day = null, now} = {}) → string     // WhatsApp-ready summary (§13.4)
ordersCsvRows(s), orderSummaryCsvRows(s), paymentsCsvRows(s) → string[][]   // header row first; amounts as rupee numbers
csv(rows) → string                         // '﻿' + CRLF rows; quote all; prefix "'" to text starting with = + - @ TAB CR
                                           // (plain numbers such as -20.00 are left numeric)

// backup
exportBackup(state, media) → { app: 'ManageYourStall', format: 'mys-backup', version: 2, exportedAt, state, media }
validateBackup(input) → { state, media, warnings: string[] }
  // accepts the v2 wrapper, a raw v2 state, or a raw v1 state (migrated first). Deep-validates config (validateConfig) and both
  // sessions (ledger invariants above). media: { [id]: 'data:image/(png|jpeg|webp|gif);base64,…' } ≤1.5 MiB (1,572,864 decoded bytes) each, ≤40 MiB total.
  // Product images referencing missing media are reset to null (+ a warning). Throws on anything else invalid.
```

```ts
interface Report {
  scope: 'all' | string;                       // or the IST day
  collected: Paise; food: Paise; gameIncome: Paise;
  methods: { Cash: Paise; UPI: Paise; Other: Paise };
  orders: number;            // eligible = status paid | partial
  units: number;             // Σ quantities of eligible orders (a combo line counts once)
  average: Paise;            // mean net of eligible orders (rounded)
  gross: Paise;              // Σ subtotal of non-pending orders (incl. void/refunded) — "gross item value"
  discounts: Paise;          // Σ discount of non-pending orders
  refunds: Paise;            // Σ |negative payments| (positive number)
  games: number;             // non-void plays
  expenses: Paise;           // Σ extra expenses in scope
  pending: { count: number; amount: Paise };
  best: { productId: string; name: string; units: number; revenue: Paise }[];   // eligible lines, units desc, revenue desc
  categories: Record<string, Paise>;           // gross line value by category name (eligible)
  hourly: Record<string /* 'HH' IST */, Paise>; // net payments by hour — sort Object.keys before rendering ('10'…'23' enumerate first)
  discountUses: Record<string /* label */, { count: number; amount: Paise }>;
  mission: {
    investment: Paise;       // missionTarget(c)
    extraExpenses: Paise;    // Σ all session expenses
    target: Paise;           // investment + extraExpenses  (= break-even)
    collected: Paise;        // all-time session collections
    remaining: Paise;        // max(0, target − collected)
    profit: Paise;           // collected − target (may be negative)
    percent: number;         // 0–100 clamped (0 when target is 0)
    recovery: number;        // unclamped %, 0 when target is 0
    profitMode: boolean;     // target > 0 && collected ≥ target
    hasTarget: boolean;      // target > 0
  };
}
```

Milestone evaluation (all-session report): `orders` → `r.orders ≥ target`; `revenue` → `r.collected ≥ target`; `recovery` →
`r.mission.hasTarget && r.mission.recovery ≥ target`; `items` → `r.units ≥ target`; `games` → `r.games ≥ target`. Reversals
(refund/void) can deactivate a milestone; `unlockedAt` keeps the first unlock time. `reference` = last order id (or last game id
for `games`) at unlock.

---

## 4. `catalog.mjs` (config editing) — pure

Every function mutates the given config (or state) in place, validates, and throws a human message on invalid input. UI calls them
inside `commitConfig(st => …)` so a throw rolls the whole write back.

```js
newId() → string                                   // uuid
missionTarget(c) → Paise                           // mode 'total' ? total : Σ items.amount
autoMilestones(c) → Milestone[]                    // fresh list (new ids) scaled to the stall; see §13.5
validateConfig(c) → c                              // deep validation of the whole Config (types, limits, refs, uniqueness)
normalizeProduct(c, data, existing = null) → Product   // fills defaults, trims, validates (does not insert)

addCategory(c, {name}) → Category                  // unique name (case-insensitive), ≤ MAX_CATEGORIES
renameCategory(c, id, name)
moveCategory(c, id, dir /* -1 | 1 */)
deleteCategory(c, id, {moveTo = null} = {})        // non-empty needs moveTo (existing other category); last category can't go

saveProduct(c, data) → Product                     // create (no/unknown id → new id, appended after its category's last item) or update
duplicateProduct(c, id) → Product                  // "Name (copy)", new id, priceLocked false, inserted after the original
deleteProduct(state, id)                           // throws if a combo uses it (names the combos); strips it from both drafts
moveProduct(c, id, dir)                            // swaps with the previous/next product of the SAME category
setSoldOut(c, id, soldOut) · setActive(c, id, active)
setPrices(c, {[id]: Paise | null})                 // batch; throws "Unlock “<name>” to change its price." if a locked price would change
setPriceLock(c, ids /* string[] | 'all' */, locked)

saveAddons(c, addons /* {id?, name, price}[] */)   // replaces list; ids kept for existing
saveFlavours(c, flavours /* string[] */)           // trims, drops blanks, unique, ≤40 chars each, ≤30 items
addStockPool(c, name) → key · deleteStockPool(c, key)   // delete only if no product uses it
saveStock(c, used /* stockUsed(session) */, {inventory, stock})   // totals can't go below used

saveDiscount(c, data) → DiscountRule · deleteDiscount(c, id) · moveDiscount(c, id, dir) · setAllowCustomDiscount(c, on)
saveMission(c, {mode, total, items})
saveMilestone(c, data) → Milestone · deleteMilestone(c, id) · moveMilestone(c, id, dir) · replaceMilestones(c, list)
saveGame(c, data) → Game · deleteGame(c, id)       // history keeps play snapshots
saveProfile(c, partialProfile) · saveTheme(c, {accent}) · saveUpi(c, {id, payeeName}) · saveOperators(c, {operators, operator})
setKitchenQueue(c, on)
```

`validateConfig` rules (non-exhaustive): ids unique per collection & `ID_RE`; text within `LIMITS`; categories ≥1, ≤40; products ≤300
and every `categoryId` exists; price `null` or integer 0…₹10,00,000; `tint`/`pattern`/`tags` from constants; `art` matches `ART_ID_RE` /^[a-z0-9-]{1,40}$/
(unknown ids render the fallback); `image` null | `MEDIA_RE` | `IMAGE_URL_RE`; `stockKey` '' or key of `stock`; `stockUnits` ≥1;
bundle components exist, are not bundles, quantity 1…99, bundle non-empty; addons price ≥0; games fee ≥0; discount rules valid
(§2); mission valid; milestones valid; `upi.id` '' or `UPI_RE`; accent `HEX_RE`; `operators` ≥1 unique; `operator` non-empty;
`eventDate` '' or `DATE_RE`. Numeric and collection caps beyond `LIMITS` live in `catalog.CATALOG_LIMITS` (use them for input
hints: stockUnits ≤999, bundle quantity ≤99, ≤40 add-ons, ≤30 flavours, ≤30 games, ≤20 discounts, ≤40 milestones, ≤30 mission
items, ≤20 operators, ≤60 stock pools). Helpers reject non-boolean flags (pass `el.checked`, never `'on'`) and non-integer prices
(parse with `paise()` first). `saveStock` only updates existing pools — create new ones with `addStockPool` first. Stock pool keys
are slugs (`'chips-small'`); display them humanized (`Chips small`).

---

## 5. `templates.mjs` — pure data, **no imports**

```js
TEMPLATES → [{ id, name, emoji, tagline, description, accent, art }]     // picker cards, in this order:
  // 'snacks-pizza'  "Snacks & Pizza Stall"        (default for new installs)
  // 'chai-maggi'    "Chai, Coffee & Maggi Point"
  // 'chaat-momo'    "Chaat & Momo Hub"
  // 'drinks-games'  "Drinks & Carnival Games"
  // 'blank'         "Blank stall"
buildTemplate(id, {withPrices = true} = {}) → {
  templateId, accent, tagline, subTagline,
  categories, products, addons, flavours, games, discounts, allowCustomDiscount, mission, milestones,
  inventory: false, stock, kitchenQueue: true
}   // unknown id throws. withPrices:false → every product price null (stall setup mode). Deep-fresh objects each call.
```

Content rules: deterministic slug ids (`'masala-chai'`, combos `'combo-…'`); every product fully populated per §2 (`priceLocked:false`,
`image:null`, `active:true`, `soldOut:false`); `art` ids only from `library.REQUIRED_ART_IDS`; realistic 2026 college-fest INR prices
(₹10–₹200); sizes as separate products (e.g. "Masala Maggi · Half/Full" or "Veggie Chips Chaat · Small/Large"); 1–3 combos with
bundle prices below the component sum; tags used sparingly (BESTSELLER, SPICY, NEW, POP, COMBO, CHILLED); 3 discount rules
(e.g. "Reel story? ₹10 off" flat, "Friends & faculty ₹20 off" flat min ₹100, "Festive 10% off" percent min ₹200 inactive);
itemized mission (Stall rent, Raw materials, Disposables & plates, Banner & decor, Helper cost — `snacks-pizza` sums to ₹5,140);
6–7 milestones (First sale, ₹1,000 Club, Crowd magnet 25 orders, Halfway there 50%, Break-even boss 100%, ₹10,000 Dhamaka, + Game
on if games exist). `blank`: categories Snacks/Drinks/Combos, no products, no games, mission itemized with the five labels at ₹0,
the same discounts and milestones. Games: `snacks-pizza` 1 free "Spin the Wheel"; `drinks-games` Ring Toss ₹20, Spin the Wheel ₹30,
Dart Game ₹20, Lucky Cup ₹10; others none. Every built template must pass `validateConfig` once merged into a config.

**Profile defaults for fresh installs** (`initialState`): stallName "My Awesome Stall", booth "Stall No. 1", tagline/subTagline from
the template, eventName "College Fest", venue '', city '', eventDate '', ownerName "Team Stall", initials '', operators
["Team Stall", "Cashier 1", "Cashier 2"], operator "Team Stall", upi { id: '', payeeName: '' }, theme accent = template accent.

---

## 6. `qr.mjs` — pure QR encoder

```js
encodeQR(text, {ecc = 'M', minVersion = 1, maxVersion = 40} = {}) → { version, size, ecc, mask, modules: boolean[][] }  // modules[y][x]
qrSvg(text, {ecc = 'M', margin = 4, dark = '#171717', light = '#ffffff', label = 'QR code'} = {}) → string
  // <svg xmlns viewBox="0 0 N N" shape-rendering="crispEdges" role="img" aria-label=label> one <rect> background + one <path> of dark modules
```
Byte mode (UTF-8), ECC L/M/Q/H, versions 1–40, automatic mask selection by the standard penalty rules. Throws
`Error('Text is too long for a QR code.')` when it doesn't fit. Verified by decoding with `jsqr` in `tests/qr.test.mjs`.

---

## 7. Visual library (`library.mjs`, `art/*.mjs`)

Batch files default-export `{ [id]: { label, group, keywords: string[], svg } }`. `svg` is **inner markup** for a `0 0 150 150`
viewBox; `artSvg(id)` adds the `<svg>` wrapper and a soft ground shadow at y≈136. Required ids per batch: `library.REQUIRED_ART_IDS`
(snacks.mjs → group `snacks`; mains.mjs → `mains`; drinks.mjs → `drinks`; sweets.mjs → groups `sweets`, `combos`, `games`).

Drawing contract (Neo-Brutalist food stickers): bold flat shapes; ink outlines `#171717` stroke 2.5–3 (details 1.5–2);
a **hard offset shadow** under the main silhouette (same shape filled `#171717`, offset +4,+4); highlight strokes in `#fff9ed`;
palette — yellow `#ffdd35`, pink `#ff4d87`, coral `#ff6b5b`, orange `#ff9f43`, mint `#7ee0b5`, lime `#b9f36b`, green `#42934b`,
lavender `#c7b6ff`, sky `#8fd3ff`, cream `#fff9ed`, crust `#e8a54b`, fried gold `#f6b43b`, brown `#9b633e`, dark brown `#5a3a22`,
red `#eb4235`, white `#ffffff`. Fill the 18–132 box, slightly playful (tilt, steam, sparkles allowed). Recognizable at 64 px.
**Forbidden:** `<svg>`, `<style>`, `<script>`, `<image>`, `<foreignObject>`, `id=`, `href`, `url(`, gradients/filters, external
references, brand names or logos (generic cola/lemon/orange only), text except tiny generic labels (≤5 chars). ≤ 9,000 chars each.
`tests/art.test.mjs` enforces the machine-checkable parts.

---

## 8. `storage.mjs` — IndexedDB adapter

DB name **`packet-pataka-v1`** (legacy name kept so existing devices keep their sales), version **2**, object stores:
`state` (key `'root'` → State) and `media` (key = media id → `{ id, data: dataURL, bytes, at }`). BroadcastChannel `'mys-ledger'`.

```js
openDB() → IDBDatabase                     // creates missing stores on upgrade (v1 DBs only have 'state')
init() → State                             // opens DB, runs an empty mutate (migrates/initializes), returns state
read() → State                             // migrated
mutate(fn) → { state, output }             // one strict-durability readwrite tx: get root → migrate(root || initialState())
                                           // → fn(state) (must be sync; a returned Promise aborts) → revision++ → put. Success
                                           // resolves only after tx.oncomplete; any throw aborts and rejects (nothing persists).
                                           // Broadcasts the revision to other tabs on success.
onExternalChange(fn)
getAllMedia() → Record<id, dataURL>
putMedia(id, dataURL) → void               // validates data URL (png/jpeg/webp/gif) and size ≤ 1.5 MiB decoded
deleteMedia(ids) → void
replaceAll(state, media) → State           // atomic restore / factory reset across both stores (clears media not provided)
pruneMedia() → number                      // deletes media ids not referenced by state.config.products; returns count
```

---

## 9. UI kernel — `ui/core.mjs`

Rendering model (same as v1): the whole app is re-rendered with `innerHTML` from the persisted state after every change. Sheets
(modals) are a single `<dialog id="sheet">` whose content is replaced by `openSheet`. A second `<dialog id="pin-dialog">` stacks
on top of the sheet for admin PIN prompts so an open form is never destroyed. Screens and actions are registered by modules.

```js
// state
store            // { state: State }  — always the latest committed state
S() → Session    // store.state[store.state.mode]
C() → Config     // store.state.config
ui               // shared transient UI state: { screen: 'sell' }   (modules keep their own module-level transient vars)

// markup helpers (all escape their text inputs; `label` args may contain trusted markup such as icons)
esc, money, paise, tokenLabel                         // re-exported from util.mjs
icon(name, cls = '') → svg                            // icons.mjs; unknown names render 'spark'
btn(label, action, cls = '', attrs = '')              // <button type="button" class=… data-action=…>
field(label, name, value = '', type = 'text', extra = '', hint = '')
textarea(label, name, value = '', extra = '', hint = '')
select(label, name, options /* [value,label][] | string[] */, value, extra = '')
check(name, label, checked = false, extra = '')       // checkbox row
toggle(action, label, on, attrs = '')                 // 1-tap switch button: aria-pressed, class 'toggle on'
heading(title, subtitle = '', right = '')             // screen heading block
emptyState(iconName, title, text = '', actionHtml = '')
artFrame(item /* {art,image,tint,pattern,name?} */, {size = 'md', cls = ''} = {})   // tinted/patterned frame with <img> or artSvg
date(iso) → '4 Nov, 6:30 pm' (IST) · time(iso) → '6:30 pm' (IST)

// feedback
toast(text, {tone = 'ok' /* ok | warn | error */} = {})
openSheet(title, body, actions = '', kind = '', {wide = false} = {})   // body may include <div data-error> slot automatically
closeSheet() · sheetKind() → string · sheetEl() → HTMLDialogElement
showError(err)                                         // into the open sheet's error slot, else a toast
confirmSheet({title, body, confirmLabel = 'Confirm', danger = false, typed = '', onConfirm})   // typed phrase must match exactly

// state changes
commit(fn, {render = true} = {}) → output             // storage.mutate(fn) → store.state = result.state → render()
commitConfig(fn, opts) → output                       // like commit, then validateConfig(state.config) inside the same tx
render()                                               // re-render #app; preserves focus + caret of the focused element by id
navigate(screen)                                       // ui.screen = screen; render(); scroll to top

// registration
registerShell(fn /* (screenHtml) => html */)
registerScreen(key, renderFn /* () => html */)
registerActions(map /* {name: (el, ds, event) => any} */, {admin = [] /* names needing PIN */} = {})
registerInputs(map)    // 'input' events from elements with data-input="key" → map[key](el, event)
registerChanges(map)   // 'change' events from elements with data-change="key"
onBoot(fn)             // after the first render
runAction(name, ds = {})                               // programmatic dispatch (cross-module)

// admin & misc
requireAdmin(fn) · isAdmin() · lockAdmin()            // 10-minute sliding unlock; first use creates the PIN
download(filename, text, mime)
mediaUrl(ref) → string                                 // 'media:<id>' → cached object URL; https → as-is; else ''
saveImageDataUrl(dataURL) → Promise<'media:<id>'>      // putMedia + cache
```

Dispatch rules: one global `click` listener runs `[data-action]` handlers (skips `disabled`/`aria-disabled="true"`); a handler already
running for the same action name ignores repeat clicks (double-tap guard); thrown errors go to `showError`; `admin` actions run
`requireAdmin` first and continue automatically after a successful unlock. `submit` is always prevented; a form with
`data-submit="<action>"` runs that action on Enter. Online/offline events and other-tab writes re-render (other-tab writes also close
an open sheet with a toast).

---

## 10. Shell, routes & brand — `ui/shell.mjs`

Screens (`registerScreen` keys): `sell`, `orders`, `dashboard`, `milestones`, `menu`, `studio`, `more`, `games`.
Desktop sidebar nav: Sell · Orders · Dashboard · Milestones · Menu · Studio · More. Mobile bottom nav (≤760px): Sell · Orders ·
Dashboard · Menu · More. Orders nav shows a badge with the kitchen queue count (preparing + ready) when > 0.

Brand block (sidebar ≥951px; topbar brand area ≤950px): sticker-style **MYS** mark (Archivo, italic, accent fill, ink outline, hard
shadow, slight tilt) + small "ManageYourStall" wordmark + the permanent credit badge **`created by viraj`** directly below — visible
at every viewport width, never editable. Stall identity (owner data) appears separately: sidebar stall card (stall name + booth),
topbar title `STALL NAME · BOOTH` and sub-line `event · venue · city · date` (blank parts skipped). Sidebar bottom: tagline card
(profile.tagline + event line) and "Saved on this device" status. Topbar right: online/offline pill, operator name, avatar with
profile initials (action `operator` → switch cashier sheet). Practice mode shows the black demo bar with "Back to live".
`document.title` = `${stallName} · ManageYourStall`. The `--accent` CSS variable follows `config.theme.accent`.

---

## 11. Actions — names & owners

Names are namespaced by owner; only the listed **public** actions may be used from other modules (as `data-action` or `runAction`).

| Owner | Public actions (data attributes) |
|---|---|
| core/shell | `nav` (`data-screen`), `close`, `operator`, `save-operator`, `lock-admin` |
| sell | `sell-add` (`data-id`) — add/customize a product · `sell-quick-edit` — toggle quick-edit mode |
| checkout | `co-open` — open Review & pay for the current cart |
| orders | `ord-receipt` (`data-id`) · `ord-queue` — go to Orders › Queue tab |
| dashboard | `dash-report` — open the day report / WhatsApp sheet |
| milestones | — |
| menu | `menu-price-board` · `menu-new-product` (`data-category`?) · `menu-edit-product` (`data-id`) · `menu-quick-price` (`data-id`) · `menu-toggle-soldout` (`data-id`) · `menu-stock` |
| picker | — (menu calls `openPicker()` directly, §13.7) |
| studio | `studio-open` (`data-section`: `profile` `templates` `upi` `discounts` `mission` `team` `games` `look`) |
| onboarding | `onb-open` — reopen the welcome/template flow |
| more/games/data | `games-open` · `data-backups` · `data-export` (`data-kind`: `orders` `summary` `payments` `json`) · `more-practice` · `more-live` |

Private actions use the owner prefix: `sell-*`, `co-*`, `ord-*`, `dash-*`, `ms-*`, `menu-*`, `pick-*`, `studio-*`, `onb-*`,
`more-*`, `games-*`, `data-*`. Inputs/changes use the same prefixes for `data-input` / `data-change` keys.

---

## 12. Design system — `css/base.css` (Neo-Brutalist)

Tokens (`:root`): `--paper #fff9ed`, `--paper-2 #fffdf5`, `--ink #171717`, `--muted #6e6b63`, `--accent` (theme, default `#ffdd35`),
`--yellow #ffdd35`, `--pink #ff4d87`, `--coral #ff6b5b`, `--orange #ff9f43`, `--mint #7ee0b5`, `--lime #b9f36b`, `--lavender #c7b6ff`,
`--sky #8fd3ff`, `--cream #f2e9d5`, soft tints `--pink-soft #ffd5e3`, `--lime-soft #dcf6b6`, `--yellow-soft #fff1bf`,
`--mint-soft #d6f7ea`, `--sky-soft #dcf1ff`, `--lavender-soft #ece6ff`, `--coral-soft #ffe2de`;
`--line 2px solid var(--ink)`, `--line-thick 3px solid var(--ink)`; shadows `--shadow-sm 2px 2px 0 var(--ink)`,
`--shadow 4px 4px 0 var(--ink)`, `--shadow-lg 6px 6px 0 var(--ink)`; radii `--r-sm 8px`, `--r 12px`, `--r-lg 16px`, `--r-pill 999px`.
Fonts: `Archivo` (display: h1/h2, logo, big numbers), `Space` (UI). Fonts are local TTFs.

Shared classes (use these; don't re-invent): buttons are styled globally — modifiers `.primary` (pink) `.accent` `.yellow` `.lime`
`.mint` `.sky` `.lavender` `.danger` (coral) `.quiet` `.small` `.icon-btn` `.block`; every non-quiet button has ink border + hard
shadow and the tactile press (`:active` → translate(2px,2px), shadow none). `.panel` (+ `.tint-*` backgrounds), `.badge` (+ color
modifiers `pink lime yellow mint sky lavender coral ink`), `.chip` / `.chip.active` (filter pills), `.segmented` (button group,
`.active`), `.toggle` / `.toggle.on` (switch-like button), `.tag` + `.tag-POP|BESTSELLER|SPICY|NEW|COMBO|CHILLED`, `.field`,
`.form-grid`, `.check-label`, `.choice` / `.choices`, `.notice` (+ `.danger .pink .mint`), `.empty-state`, `.list-row`,
`.receipt-line`, `.admin-row`, `.progress` > `.progress-fill`, `.stat`, `.screen-heading`, `.section-title`, `.row .between .wrap
.grow .stack .grid-2 .grid-3`, `.eyebrow`, `.muted`, `.price`, `.footnote`, `.separator`, `.art-frame` + `.tint-<id>` +
`.pattern-<id>` + `.size-sm|md|lg`, dialog parts `.sheet-head .sheet-body .sheet-actions`, `#sheet.wide`, `#toast` (+ `.warn .error`).

Breakpoints: ≥1500 roomy · ≤1200 · ≤950 (sidebar collapses to icons; brand moves to topbar) · ≤760 (phone: bottom nav, sheets become
bottom sheets, single column) · ≤350 (narrow). No horizontal page scroll at 320px. Tap targets ≥44px. `prefers-reduced-motion`
disables animation. Focus-visible outline `3px solid #8c35c9`.

Module CSS files only style their own prefixed classes: `.sell-*` (sell.css), `.co-*` (checkout.css), `.ord-*` (orders.css),
`.dash-*`/`.ms-*` (dashboard.css), `.menu-*` (menu.css), `.pick-*` (picker.css), `.studio-*`/`.onb-*` (studio.css),
`.more-*`/`.games-*`/`.data-*` (more.css). They may use base tokens/classes but must not restyle base classes globally.

Voice: short, warm, desi fest energy ("Let's make some noise", "Paisa vasool", "Dhamaka") but always clear about money. Never claim
the app verifies bank payments. No "Packet Pataka" in UI copy (it may appear only as migrated owner data).

---

## 13. Screens & flows (UI wave)

### 13.1 Sell (`ui/sell.mjs`)
Hero heading = `profile.tagline` / `profile.subTagline` with a "Customize stall" button (→ studio) and readiness badge
("12/14 PRICED"). Mini mission strip (recovered / target, % bar; "PROFIT MODE 🔥" styling when profitMode; "Set your investment"
link when no target). Setup banner when any visible product is unpriced → `menu-price-board`. Search box (name/subtitle/size/
category/tags), filter chips: All · 🔥 Top sellers (top 6 by units in this session; hidden until there are sales) · each category ·
Games (if games exist → `games-open`). Product grid cards: `artFrame`, tags, name, size chip, subtitle, price (or "SET PRICE"),
low-stock/sold-out ribbons, quantity badge. Card markup is an `<article>` with a main `<button data-action="sell-add">` and, when the
product is in the cart, a separate − qty + stepper (no nested buttons). Quick-edit mode (`sell-quick-edit`): each card shows tools —
sold-out toggle (`menu-toggle-soldout`, no PIN), quick price (`menu-quick-price`), edit (`menu-edit-product`). Cart panel (desktop) /
sticky mobile cart bar + cart sheet: lines with steppers & remove, order note (add/edit), Clear cart (confirm), subtotal/discount/
total, "Review & pay" (`co-open`). Customize sheet for `customizable` products: flavour select (if any), add-on choices, quantity,
line note, live price. Ctrl+Enter opens checkout.

### 13.2 Checkout (`ui/checkout.mjs`)
Sheet: line summary; discount chips (one active at a time; tap again to remove; minimum hint); "Custom" chip (₹ or % input) when
allowed; totals; payment segmented control **Cash · UPI · Split · Other**. Cash: quick-tap `Exact ₹50 ₹100 ₹200 ₹500` (notes below the
total disabled) + custom amount → big "Return ₹X" change display. UPI: when `upi.id` set, a large scannable QR (`qrSvg(upiUri(c, total,
'Token #NN · stall'))`) with amount and payee, plus "I received ₹X on UPI" confirmation checkbox (required); when not set, a hint
linking to Studio › UPI and the confirmation checkbox. Split: cash part input (+ quick buttons) → UPI part auto = total − cash, QR for
the UPI part, confirmation for the UPI part, change for the cash part. Other: confirmation checkbox. "Save as pending (not paid yet)".
Complete button shows the amount; double-tap safe (idempotent `draftId`); refuses if the cart changed in another tab. Success sheet:
giant token `#07`, total, method, "Next order" (primary) and "View queue" (`ord-queue`), receipt link.
Use `upcomingToken(S())` for the token shown in the UPI note before the order exists. Pass `S().draftDiscount` to `createOrder` as-is.
**Stale discounts:** if `S().draftDiscount` is set but `resolveDiscount(C(), S().draftDiscount)` is null (rule deleted/deactivated or
custom discounts turned off), clear it with `setDraftDiscount(S(), C(), null)` in a commit when opening checkout — otherwise
`createOrder` throws "That discount is not available any more." while no chip is lit.

### 13.3 Orders (`ui/orders.mjs`)
Tabs: **Queue** (default when `kitchenQueue` on) · **All orders**. Queue: two columns (stacked on phones) Preparing / Ready with big
token cards (token, items summary, note highlighted, age "4 min", UNPAID badge for pending), one-tap advance (Preparing → Ready →
Handed over) and undo; "Reset tokens" (confirm). All orders: search (token, order number, item name), filter chips (All, Cash, UPI,
Split, Other, Pending, Refunded/Void), rows with token, time, method, status, total. Receipt sheet: token + order number, status,
kitchen status, items with snapshot prices, note, discount label, totals, net collected, split parts, cash/change, audit history;
actions: Confirm payment (pending; method incl. Split + UPI QR), Correct order (admin; refund amount + method for Split, or void, reason
required, confirmation), kitchen status buttons.

### 13.4 Dashboard (`ui/dashboard.mjs`) & day report
Mission hero: "THE ₹X MISSION" with collected / target, progress, remaining or **PROFIT MODE 🔥** (celebration styling: accent burst,
confetti-like CSS shapes, "₹Y profit"), breakdown (investment items + extra expenses), "Edit mission" (`studio-open` mission).
Stat tiles: collected, orders, items, average order, Cash, UPI, discounts, games, pending. Panels: bestsellers, recent orders
(`ord-receipt`), payment split bars, menu mix by category, hourly (IST), honest numbers (gross, discounts, refunds, net food, game
income, extra expenses, profit/loss vs break-even). Buttons: "Day report" (`dash-report`), "Export" (`data-backups`). Report sheet: scope
toggle **Today (IST)** / **Whole event**, preview of `dayReportText`, **Copy report** (clipboard with fallback) and **Share to WhatsApp**
(`https://wa.me/?text=` + encoded text, new tab) and native **Share…** when `navigator.share` exists.

`dayReportText` format (WhatsApp markdown, emoji allowed):
```
*🧾 <Stall name> — Day report*
<booth> · <event> · <date label>
💰 Collected: ₹X  (💵 Cash ₹ · 📲 UPI ₹ · Other ₹)
🧾 Orders: N · Items: U · Avg: ₹V
🎯 Break-even: ₹T (investment ₹I + extra costs ₹E)
📈 Recovered: P% — ₹R to go | 🔥 PROFIT MODE: ₹Y profit
🏆 Top sellers:
1. Name — 12 sold
…(up to 3)
🎮 Games: n plays · ₹ fees        (only if games)
⏳ Pending: n orders · ₹          (only if any)
_Sent from ManageYourStall (MYS)_
```
No target → `🎯 Break-even: not set yet`; no sales → `🏆 Top sellers: none yet`; whole-event scope date line
`Whole event till <d Mon yyyy>`.

### 13.5 Milestones (`ui/milestones.mjs`)
Grid of milestone cards (unlocked / reversed-keep-going / next) with progress (`milestoneProgress`), unlock time, count badge
"3 / 7 UNLOCKED", mini mission strip. Editor (admin): add, edit (title, type, target with unit-aware input: ₹ for revenue, % for
recovery), delete, reorder, "Auto-generate for my stall" (`autoMilestones`, confirm replace). `autoMilestones(c)`: First sale (orders 1),
₹1,000 Club (revenue), Crowd magnet (orders 25), Halfway there (recovery 50), Break-even boss (recovery 100), a stretch revenue goal
rounded to a nice number ≈ 2× investment (min ₹10,000 "Dhamaka"), and Game on (games 1) if games exist.

### 13.6 Menu manager (`ui/menu.mjs`)
Screen sections per category (in order) with category header tools (rename, ↑ ↓, delete with "move items to…"), product rows:
thumbnail `artFrame`, name, size, tags, price or SET PRICE, 🔒 lock indicator, 1-tap **Sold out / In stock** toggle (no PIN), 1-tap
**Visible** toggle, Edit, Duplicate, ↑ ↓, Delete (confirm). Toolbar: + Item, + Category, + Combo, Price board, Add-ons & flavours,
Stock room. Product editor sheet (wide): name, subtitle, category (or create new inline), size (with suggestions), price + lock,
tags toggles, Visual (`openPicker` → returns art/image/tint/pattern; shows live preview), customizable checkbox, stock pool + units,
visible, sold out. Combo editor: component products with quantities + combo price + savings hint. Price board sheet: every product
with an inline price input and lock toggle, "Lock all", "Unlock all", "Save all" (one `setPrices` commit). Quick price sheet
(`menu-quick-price`): single price input (disabled with an "Unlock price" button when locked). All menu mutations except sold-out
are admin actions.

### 13.7 Visual picker (`ui/picker.mjs`)
`export function openPicker(current /* {art, image, tint, pattern, name} */, onDone /* (selection) => void */, {onCancel} = {})`
Wide sheet with tabs: **Library** (search + group chips, grid of 45+ illustrations, selected state), **Upload** (file input
`accept="image/*"` → downscale to ≤320px longest side via canvas → WebP (JPEG fallback) ≤ ~150 KB → `saveImageDataUrl`), **Link**
(https URL + live preview + offline warning), **Style** (tint swatches, pattern swatches, live preview card). "Use this" calls
`onDone({art, image, tint, pattern})`; Cancel calls `onCancel`. The picker must not mutate state itself (the editor commits).

### 13.8 Stall Studio (`ui/studio.mjs`) & onboarding (`ui/onboarding.mjs`)
Studio screen ("Backstage") sections with anchors: **Profile** (all profile fields, live preview of hero + topbar), **Look** (accent
swatches + custom color, preview), **UPI** (UPI ID + payee name, validation, sample QR preview for ₹1), **Discounts** (rules CRUD,
reorder, active toggle, allow custom), **Mission** (Total vs Itemized segmented; item rows CRUD with suggestions; live sum; note
that extra costs recorded during the event add to break-even), **Team** (operators list, current operator, kitchen queue toggle),
**Games** (CRUD: name, fee, art), **Templates** (cards for `TEMPLATES`, "Include suggested prices" checkbox, apply with confirmation:
"replaces menu, categories, discounts, games, mission and milestones; sales history stays"). Admin-guarded saves. Deleting or deactivating a discount rule, or turning custom discounts off, must also clear any matching
`draftDiscount` in **both** sessions in the same commit (`setDraftDiscount(st.live, st.config, null)` etc.). `TEMPLATES` entries are
frozen — copy before modifying; `withPrices:false` only nulls product prices (add-on prices and game fees stay).
Onboarding (first run, `onboarded === false`, and `onb-open`): wide sheet, 3 steps — 1) pick a template (or keep the sample menu),
2) name your stall (stall name, booth, event, tagline), 3) "Your stall is ready" tips (Set prices · Add UPI · Start selling) →
sets `onboarded: true`. Skippable at any step ("Explore the sample stall").

### 13.9 More, games & data (`ui/more.mjs`, `ui/games.mjs`, `ui/data.mjs`)
More hub tiles: Stall Studio, Menu manager, Price board, Game corner, Stock room, Expenses, Day report, Backup & exports, Practice
counter / Back to live, Event setup (start live checklist), Admin PIN, Install app, Persistent storage, Danger zone. Game corner screen
(`games`): game cards with play counts, record play sheet (prize, fee payment method + confirmation), recent plays with reverse
(admin + reason). Expenses sheet: category, amount, description, list. Backups sheet: exports (itemized orders CSV, order summary CSV,
payments CSV, full JSON backup incl. media), restore (validate → summary → admin + confirm → `replaceAll`), **Reset today's orders
(keep menu & setup)** (admin + type `RESET ORDERS`; resets current mode's session only), Reset practice ledger, **Factory reset entire
stall** (admin + type `FACTORY RESET`; wipes state + media, onboarding reopens). Event setup: price checklist, live/practice counts,
"Start live event" (never erases sales).

---

## 14. Migration v1 → v2 (`migrate`)

v1 = Packet Pataka (`version: 1`, `config.menuVersion`). Must be lossless for money: the migrated live ledger's `report()` must equal
`tests/fixtures/v1-expected.json` for collected, methods, orders, units, games, gameIncome, expenses, discounts, refunds, pending.
- `onboarded` = true if any session has records, any product has a price, or a PIN exists; else false.
- profile ← stallName, booth `Stall No. ${stallNumber}`, tagline "Little packets. Big pataka energy.", subTagline "Good food. Fast
  orders. A fest to remember.", eventName "Diwali Celebration", venue "Baderia Global Institute", city "Jabalpur", eventDate,
  ownerName = operator, initials ''. theme.accent ← accent. upi empty. templateId 'legacy'. kitchenQueue true.
- categories from distinct product categories (order of first appearance, ids slugged); products gain `categoryId`, `subtitle ''`,
  `priceLocked false`, `image null`, `pattern 'none'`, `tags` (`['COMBO']` for bundles), `customizable false`, keep `art`/`tint`
  (v1 `blue` → `sky`); legacy `base`/preset products (none in practice) become plain products priced base+addons, or null.
- discounts ← `promo > 0` → `[{id:'promo', label:'Reel / banner ₹X off', type:'flat', value:promo, minimum:promoMinimum, active:true}]`.
- mission ← `{mode:'total', total: target, items: []}`. milestones ← ids `spark` (First Spark, orders 1), `game` (Game On, games 1),
  `crowd` (Crowd Magnet, orders 50), `big` (The Big Pataka, recovery 100) so unlock history carries over.
- games gain `art` (`spin-wheel` for wheel, `lucky-cup` otherwise). Sessions gain `draftDiscount` (`draftPromo` → `{ruleId:'promo'}`),
  `draftNote ''`, `tokenDay null`, `tokenSeq 0`; draft lines gain `note ''`. Orders gain `token null`, `tokenDay null`,
  `discountInfo` (discount > 0 → promo snapshot), `note ''`, `split null`, `kitchen 'handed'`, `kitchenAt {}`.
- `version: 2`, `config.schema: 2`; drop `menuVersion`, `promo`, `promoMinimum`, `target`, `stallName`, `stallNumber`, `eventDate`,
  `accent` from the config root.

Note: v2 break-even = investment + extra expenses, so migrated `remaining` differs from v1 by recorded expenses (intended).

---

## 15. Verification

- `npm run verify` must pass (syntax/imports/precache/branding check, typecheck of pure modules, all unit tests).
- Unit tests: domain (ledger, discounts, split, refunds per method, tokens incl. IST day rollover, kitchen, reports, milestones,
  day report text, CSV escaping, UPI URI, backup validation incl. corruption cases, migration fixture), catalog (every helper +
  validateConfig failure cases), templates (each builds, validates, art ids exist, combos reference real products, prices),
  QR (jsQR round-trips, all ECC levels, versions 1–10+, UTF-8), art (§7), storage (atomicity, rollback, concurrency, media store,
  replaceAll, v1 DB upgrade path).
- Browser (Playwright, desktop 1440 / mobile 390 / narrow 320): onboarding, sell→checkout (cash change, UPI QR visible, split),
  token + queue, receipt/refund, menu CRUD + picker + price lock, studio profile → topbar/hero update, discounts at checkout,
  mission profit mode, WhatsApp report text, backup → restore round-trip, resets, offline reload, no horizontal overflow.

**v1 feature inventory (must survive):** price-locked setup mode; product variants & combos with component stock; add-ons/flavours;
persisted cart surviving reload; promo/discount once per order with minimum; Cash/UPI/Other with explicit receipt confirmation;
optional cash calculator; pending orders + later confirmation; corrections (partial/full refund, void) with reasons + audit trail;
games ledger (free/paid, prizes, reversal); expenses; dashboard (collections, methods, bestsellers, category mix, hourly IST, honest
numbers); milestones with reversal; stock room; practice vs live ledgers; event setup checklist; local admin PIN (10-min unlock);
operators; CSV (itemized + payments) with formula-injection escaping; JSON backup/validated restore; typed-confirmation resets;
persistent-storage request; install prompt; offline service worker; multi-tab safety (BroadcastChannel, idempotent checkout);
accent color setting; accessibility (44px targets, focus styles, reduced motion, aria labels).

---

## 16. Phase 2 — themes, money tracking, team splitter, Stall's Collab, responsive polish

Phase 2 extends schema v2 **additively** (no version bump; `migrate()` fills every new field with `??=` defaults, idempotently;
`validateBackup` accepts Phase-1 v2 backups by migrating first). Everything below is binding for Phase 2 work.

### 16.1 Data model additions

```ts
interface Config {                       // additions / changes
  theme: {
    accent: string;                      // existing (#RRGGBB)
    themeId: string;                     // template id the look came from, or 'custom'
    secondary: string;                   // second palette colour (#RRGGBB) for hero blobs, chips, highlights
    heroArt: string[];                   // 0–3 library art ids composing the themed hero illustration
    heroTint: string;                    // TINT id — hero background
    heroPattern: string;                 // PATTERN id — hero background pattern
    heroImage: null | string;            // custom stall photo: 'media:<id>' | 'https://…' (overrides heroArt)
  };
  team: {
    members: TeamMember[];               // partners who fund the stall and split the profit (≤20)
    splitMode: 'equal' | 'custom';       // custom → every member's share is an integer % and they sum to 100
  };
  mission: { mode: 'ledger' | 'total' | 'itemized'; total: Paise; items: {id; label; amount}[] };
  // 'ledger' (NEW, default for templates/new installs): break-even = Σ bills in the expense ledger; `items` are only
  //   quick-add suggestions for bills. 'total'/'itemized' (planned): break-even = planned + Σ bills (Phase-1 semantics).
}
interface TeamMember { id: string; name: string /* ≤40, unique ci */; color: string /* TINT id */; share: number | null /* custom % */ }

interface Session {                      // additions
  expenses: Expense[];                   // upgraded shape below
  contributions: Contribution[];         // money members put into the stall pool ("contri")
  settlements: SettlementSnapshot[];     // saved end-of-stall settlements (immutable snapshots)
}
interface Expense {
  id; at; operator;
  title: string;                         // 1–80 chars: "20L water cans & ice"
  category: 'pre-stall' | 'restock' | 'rent' | 'packaging' | 'decor' | 'misc';
  amount: Paise;                         // ≥1
  method: 'Cash' | 'UPI';                // how the bill was paid
  paidBy: string;                        // team member id, or 'drawer' (stall cash drawer / pool)
  billImage: null | string;              // 'media:<id>' photo of the bill (compressed, stored on device)
  notes: string;                         // ≤500, itemized notes
  void: boolean; voidReason?: string; voidAt?: ISO;   // voided bills stay for audit, excluded from every total
}
interface Contribution { id; at; operator; memberId: string; amount: Paise; method: 'Cash' | 'UPI'; note: string /* ≤120 */;
  void: boolean; voidReason?: string; voidAt?: ISO }
interface SettlementSnapshot { id; at; operator; result: SettlementResult /* deep copy */; text: string }
```

Legacy expense upgrade (Phase-1/v1 `{category, amount, description}`): `title = description || 'Expense'`; category map
Ingredients→restock, Supplies→restock, Packaging→packaging, Helper→misc, Transport→misc, Other→misc (unknown → misc);
`method 'Cash'`, `paidBy 'drawer'`, `billImage null`, `notes ''`, `void false`. Migrated v1 stalls keep `mission.mode 'total'`.
Theme defaults on migrate: themeId = templateId if it is a known template else 'custom'; secondary '#FF4D87'; heroArt from the
template theme (v1/legacy: `['packet','pizza','cold']`); heroTint 'yellow'; heroPattern 'sunburst'; heroImage null.
Team default `{members: [], splitMode: 'equal'}`; sessions get `contributions: []`, `settlements: []`.

### 16.2 constants.mjs additions (owner: money-core agent)

`EXPENSE_CATEGORIES` becomes `[{id, label, emoji}]`: pre-stall "Pre-Stall Setup" 🧰 · restock "Mid-Stall Restock" 🔄 · rent
"Stall Rent / Registration" 🏷️ · packaging "Packaging & Plates" 🥡 · decor "Decor / Banner" 🎪 · misc "Misc" 🧾 (+
`EXPENSE_CATEGORY_IDS`). `EXPENSE_METHODS = ['Cash','UPI']`, `DRAWER = 'drawer'`, `SPLIT_MODES = ['equal','custom']`,
`MISSION_MODES = ['ledger','total','itemized']`, `RESTOCK_SUGGESTIONS` (e.g. "Extra cheese & buns", "20L water cans & ice",
"Plates & cups", "Oil refill", "Loose change"), LIMITS `expenseTitle 80`, `expenseNotes 500`, `memberName 40`, `contriNote 120`,
`MAX_MEMBERS 20`.

### 16.3 domain.mjs additions (pure; owner: money-core agent)

```js
addExpense(s, c, {id, title, category, amount, method = 'Cash', paidBy = 'drawer', billImage = null, notes = ''}, now) → Expense
  // idempotent on id; paidBy must be 'drawer' or an existing member; also accepts legacy {description, category:'Ingredients'…}
updateExpense(s, c, id, patch, now) → Expense     // title/category/amount/method/paidBy/billImage/notes; audit before/after
voidExpense(s, c, id, reason, now)                 // reason required; audit 'expense-void'
addContribution(s, c, {id, memberId, amount, method = 'Cash', note = ''}, now) → Contribution   // idempotent
voidContribution(s, c, id, reason, now)
expenseTotals(s, {day = null} = {}) → { total, count, byCategory: {[cat]: Paise}, byMethod: {Cash, UPI},
                                        byPayer: {[memberId | 'drawer']: Paise}, restock, preStall }
teamSettlement(s, c) → SettlementResult
settlementText(s, c, {now} = {}) → string          // WhatsApp-ready, see below
saveSettlement(s, c, now) → SettlementSnapshot     // audit 'settlement-saved'
applyTheme(state, themeId, {menu = false, withPrices = true, keepPhoto = true} = {}, now)
  // copies buildTemplate(themeId).theme into config.theme (themeId set; heroImage kept when keepPhoto); menu:true also runs
  // applyTemplate(state, themeId, {withPrices}); audit 'theme-applied'
referencedMedia(state) → Set<string>               // every media id referenced by products, theme.heroImage and bill photos
                                                   // in both sessions (storage.pruneMedia MUST keep all of them)
expensesCsvRows(s, c) · contributionsCsvRows(s, c) · settlementCsvRows(s, c) → string[][]
```
Report changes: `r.expenses` = Σ non-void bills in scope; new `r.expenseTotals` (= expenseTotals for the scope);
`r.mission` gains `mode`, `planned` (missionTarget(c); 0 in ledger mode), `bills` (Σ non-void bills, whole session),
`restock` (Σ restock bills). Existing fields keep working: **ledger** → `investment = bills`, `extraExpenses = 0`;
**total/itemized** → `investment = planned`, `extraExpenses = bills`. Always `target = investment + extraExpenses`,
`profit = collected − target` (= revenue − total dynamic expenses in ledger mode). Void bills/contributions never count.
Milestones (recovery type) therefore move automatically with every bill. `dayReportText` adds a bills line
(`🧾 Bills: ₹E (restock ₹R)`) when there are bills.

**Settlement math** (`teamSettlement`, all integer paise, deterministic):
- `revenue` = whole-session `report(s,c).collected` (Cash + UPI + Other, net of refunds, incl. game fees).
- `expenses` = Σ non-void bills; `pocketBills_i` = Σ bills paidBy member i; `drawerBills` = bills paidBy 'drawer' or a removed member.
- `contri_i` = Σ non-void contributions of member i; `capital_i = contri_i + pocketBills_i`; `capital = Σ capital_i`.
- `netProfit = revenue − expenses`; `pot = capital + netProfit` (= Σcontri − drawerBills + revenue): the money the team splits.
- Step 1 — capital recovery: pot ≥ capital → everyone gets `capital_i` back; 0 < pot < capital → `pot` split in proportion to
  capital_i; pot ≤ 0 → nothing.
- Step 2 — profit: netProfit > 0 → split by share (equal: 100/n each; custom: share %); members with zero capital still get their
  profit share.
- Rounding: largest-remainder method (ties → member order) so Σ recovery and Σ profitShare are exact; `payout_i = recovery_i +
  profitShare_i`, Σ payout = max(pot, 0).
- `SettlementResult = { members: [{id, name, color, sharePct, contri, bills, capital, capitalPct, recovery, profitShare, payout}],
  totals: {contri, pocketBills, drawerBills, expenses, capital, revenue, netProfit, pot, inProfit, recoveryPct},
  warnings: string[] }` — warnings for: no members; custom shares not summing to 100; pot < 0 (drawer bills exceed the money that
  went in); bills paid by removed members (counted as drawer).
- `settlementText`: `*🤝 <Stall> — Team settlement*`, revenue, all bills (by category), net profit/loss, money put in
  (contri + member-paid bills), one line per member `• Name — put in ₹X → back ₹R + profit ₹P = *₹T*`, split mode line,
  `_Sent from ManageYourStall (MYS)_`.
- Copy is honest: a fair-split calculator, not accounting/tax advice; UPI money lands in the UPI account holder's bank.

### 16.4 catalog.mjs additions (pure; owner: money-core agent)

`saveTeam(c, {members, splitMode})`, `addMember(c, {name, color})`, `renameMember(c, id, name)`, `setMemberColor(c, id, color)`,
`removeMember(state, id)` (refuses when the member has non-void bills/contributions in either session — rename instead),
`setSplitMode(c, mode)`, `setShares(c, {[id]: pct})` (custom: integers 0–100 summing to 100), `saveMission` accepts mode
`'ledger'` (items kept as suggestions), `saveTheme(c, partial)` accepts every theme field. `missionTarget(c)` returns 0 in ledger
mode. `validateConfig` validates theme (themeId `ID_RE` or 'custom'; secondary `HEX_RE`; heroArt ≤3 × `ART_ID_RE`; heroTint/
heroPattern ids; heroImage null | `MEDIA_RE` | `IMAGE_URL_RE`) and team (≤20, unique names, colors, shares rule).

### 16.5 Templates → Stall Themes (owner: themes agent)

`TEMPLATES` (each entry and `buildTemplate(id).theme` carry `theme: {accent, secondary, heroArt: [3 ids], heroTint, heroPattern}`),
in this order — 6 pre-built stall themes + blank:
`street-chaat` "Pataka Street Chaat & Snacks" (**new-install default**; carries the original stall's chips-chaat ids such as
`veggie-chips-chaat-small`, plus pani puri, bhel, samosa, kachori, aloo tikki, peri peri fries, `cola` / `lemon-fizz` /
`orange-fizz`, combos) · `snacks-pizza` "Pizza & Fizz Hub" · `chai-maggi` "Chai, Coffee & Maggi Point" · `momo-corner`
"Momo & Fast-Food Corner" (momos, burger, frankie, sandwich, pav bhaji, chole bhature, mojito; `buildTemplate('chaat-momo')` is an
alias) · `sweet-tooth` "Sweet Tooth & Dessert Bar" (brownie sundae, gulab jamun, kulfi, milkshake, lassi, cold coffee) ·
`drinks-games` "Mela Games & Lucky Zone" (games + coolers) · `blank`. Every template's mission is `{mode: 'ledger', total: 0,
items: [suggested bills]}`. New art ids `lime-can`, `orange-can` (generic cans, drinks group). `library.heroSvg(artIds, {cls})`
returns a wide `0 0 360 160` composition of up to 3 illustrations (overlapping, slight tilts, sparkles) for theme heroes.

### 16.6 Shell, breakpoints, spacing & nav (owner: shell agent)

Breakpoints change to: **desktop ≥1024px** — 3-zone command center (full sidebar · workspace · sticky right cart on Sell);
**tablet 768–1023px** — compact icon rail + brand in the topbar, 2-column card grids, cart as a slide-over drawer;
**mobile <768px** — top brand bar (`MYS` · `created by viraj`), fixed bottom nav, floating bottom checkout bar
(`X items · ₹Total · Review & Pay →`) opening a full-screen order sheet. Spacing scale tokens `--sp-1 8px · --sp-2 12px ·
--sp-3 16px · --sp-4 24px · --sp-5 32px` — every module uses only these for gaps/padding/margins.
Nav: desktop sidebar Sell · Orders · Dashboard · Expenses (`money`) · Milestones · Menu · Studio · **Stall's Collab<sup>COMING
SOON</sup>** (`collab`) · More. Mobile bottom nav (6): Sell · Orders · Stats (dashboard) · **Collab<sup>SOON</sup>** · Menu · More.
The superscript is a Neo-Brutalist pill (`<sup class="nav-soon">`) that is visible on first load at every width.

### 16.7 New screens & public actions

| Owner | Screen | Public actions |
|---|---|---|
| money (`ui/money.mjs`, `css/money.css`) | `money` — "Expenses & Team Contri": tabs **Bills** · **Team** · **Settlement** | `money-open` (`data-tab` bills/team/settle) · `money-add-bill` (`data-category`?) · `money-restock` (quick mid-stall restock sheet) |
| collab (`ui/collab.mjs`, `css/collab.css`) | `collab` — Stall's Collab concept page | — |

Money screen: Bills (summary cards by category & payer, big "+ Add bill" and "🔄 Quick mid-stall restock", ledger list with
category chip, payer avatar, method, bill-photo thumbnail, notes; detail sheet with photo zoom; edit/void are admin; adding a bill
needs **no PIN**; ledger-mode quick-add suggestion chips from `mission.items`; when mission mode is planned, a banner offers to
switch to "From my bills"), Add-bill sheet (title + suggestions, category chips, amount, Cash/UPI, paid by member chips +
"Stall cash drawer", bill photo via camera or gallery compressed to ≤1400 px / ≤600 KB JPEG, notes), Team (members leaderboard:
contri + bills paid = total put in, % of stall cost funded; record contri (admin); member setup lives in Studio › Team and the
screen links there), Settlement (totals board, Step 1 recovery + Step 2 profit visual, bold payout card per member,
Copy / Share to WhatsApp of `settlementText`, Save snapshot (admin), saved snapshots list).
Dashboard gets "+ Quick mid-stall restock" (`money-restock`) and "Add bill" buttons plus a team payout preview. More hub links to
`money-open` and `collab`. Backups include bill photos and hero photos (media); CSV exports add `expenses`, `contributions`,
`settlement` kinds (`data-export`).

### 16.8 Render speed: SVG sprite

`library.artSprite()` returns one hidden `<svg>` holding a `<symbol id="mys-art-<id>">` per illustration (`SPRITE_PREFIX`).
`ui/core.installArtSprite()` inserts it once into `document.body` outside `#app` before the first render and calls
`library.useSprite(true)`; from then on `artSvg()` and `heroSvg()` emit `<use href="#mys-art-<id>">` instead of inlining each
illustration, which keeps re-renders about 3x smaller. With sprite mode off (Node and unit tests) the output is exactly the inline
markup described in §7.

---

## 17. Phase 3 — landing page, multiple stalls, accounts & cloud (Convex)

Goal: MYS becomes a multi-stall product. A first-time visitor lands on a bold **MYS landing page**, sets up a stall with a
smooth **step-by-step wizard**, and can keep any number of stalls on the device. An optional **MYS account** (login ID +
password) stores stalls in the cloud (Convex) so they can be opened on another phone. The counter stays **offline-first**:
every sale is saved to IndexedDB first; the cloud copy syncs in the background whenever there is internet.

### 17.1 Local multi-stall storage (`storage.mjs`, owner: kernel agent)

IndexedDB stays `packet-pataka-v1` v2 (stores `state`, `media`). The `state` store now holds:
- `'meta'` → `StallsMeta { version: 1, activeStallId: string | null, stalls: StallEntry[] }`
- one key per stall: `entry.key` (the legacy stall keeps key **`'root'`** forever so an old cached tab and the new app always
  share the same data; new stalls use `'stall:<uuid>'`).

```ts
interface StallEntry {
  id: string;            // 'root' for the legacy (v1/Phase-1) stall, else a uuid
  key: string;           // IndexedDB key of its State
  createdAt: ISO; updatedAt: ISO; openedAt: ISO | null;
  summary: { name: string; booth: string; themeId: string; accent: string; heroArt: string[]; orders: number;
             collected: Paise; bills: Paise; currency: 'INR' };          // refreshed on every committed write
  cloud: null | { stallId: string; code: string; ownerLoginId: string | null; revision: number;   // last synced cloud revision
                  dirty: boolean; status: 'synced' | 'pending' | 'offline' | 'conflict' | 'error' | 'syncing';
                  syncedAt: ISO | null; lastError: string | null; access: 'owner' | 'team' };
}
```
Boot migration (inside one transaction): no `'meta'` + existing `'root'` → meta with one entry `{id:'root', key:'root'}`
active (so the existing Packet Pataka stall opens straight away, exactly as before). No meta and no root → empty meta, active
null (new visitor → landing page). Meta present but an unlisted `'root'` exists (an old cached tab created it) → add it as an
extra entry named "Recovered stall".

API (all async; one strict-durability transaction each; broadcast `{type:'meta'|'state', stallId}` on BroadcastChannel
`mys-ledger`):
```js
init() → { meta, state }            // state of the active stall (migrated) or null
getMeta() → StallsMeta
createStall(state) → { entry, state }              // new uuid entry + key, becomes active, onboarded state
openStall(id) → state                               // sets active, openedAt
leaveStall()                                         // active = null; data stays on the device
deleteStall(id)                                      // removes its state + entry, then prunes media
readStall(id) → State · writeStall(id, state)        // non-active access (cloud pull)
updateEntry(id, patch)                               // e.g. cloud status (merges cloud object)
mutate(fn) / read() / replaceAll(state, media)       // unchanged semantics, on the ACTIVE stall (throw if none)
pruneMedia()                                         // keeps media referenced by ANY stall
onExternalChange(fn)                                 // fn({type, stallId})
```

### 17.2 Kernel & routing (`ui/core.mjs`, `app.mjs`, owner: kernel agent)

`store.state` is `null` when no stall is active. Outside-the-stall pages are registered with
`registerPage(name, renderFn)` and rendered full-screen **without** the stall shell. Routes are hash based:
`#/welcome` (landing), `#/setup`, `#/stalls`, `#/login`, `#/signup`, `#/join`, `#/account`. Kernel exports:
`registerPage`, `goPage(name)` (sets `location.hash`, renders), `currentPage()`, `openStallById(id)` (storage.openStall → store
.state → reloadMedia → `location.hash = ''` → render), `leaveCurrentStall()` (flush pending cloud sync → storage.leaveStall →
store.state = null → goPage('welcome')), `hasStall()`, `onCommitted(fn)` (called after every successful commit with
`{stallId, state}` — the cloud sync engine subscribes). render(): no active stall or an outside page in the hash → page;
otherwise the shell. Boot: active stall → stall app (unless the hash names an outside page); no active stall →
`#/welcome` (or the hashed page). The old first-run onboarding sheet only runs for an active stall whose `onboarded` is false.
Shell additions (shell.mjs): sidebar/brand area and the cashier (avatar) sheet get **Your stalls** (`goPage('stalls')`) and
**Leave this stall** (`leaveCurrentStall`); a small cloud status pill (Saved on device / Synced ✓ / Syncing… / Offline – will
sync / Needs attention) when the stall is linked.

### 17.3 Convex backend (`convex/`, owner: backend agent)

Project **manageyourstall** in the `viraj-vishwakarma` team. Public URL in `dist/config.mjs` (`export const CONVEX_URL`).
All user-facing errors are thrown as `ConvexError('short friendly message')`.

Tables (`convex/schema.ts`):
- `users { loginId (normalized: trimmed, lowercased), name, passwordHash, passwordSalt, createdAt, lastLoginAt }` · index `by_loginId`
- `sessions { tokenHash, kind: 'user' | 'stall', userId?: Id<'users'>, stallId?: Id<'stalls'>, deviceId, deviceLabel, createdAt, expiresAt }` · index `by_tokenHash`, `by_user`
- `loginAttempts { key, failures, lockedUntil, updatedAt }` · index `by_key`
- `stalls { ownerId, code /* 'MYS-' + 5 chars of 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' */, name, booth, themeId, accent, heroArt: string[], eventName, city,
  teamPasswordHash?, teamPasswordSalt?, snapshotId?: Id<'_storage'>, revision: number, snapshotBytes, snapshotAt?, snapshotDevice?,
  summary { orders, collected, bills }, archived: boolean, createdAt, updatedAt }` · index `by_owner`, `by_code`

Auth (custom, no third-party keys): passwords hashed with Node `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random
salt) inside `"use node"` actions; verification uses `timingSafeEqual`. Session token = 32 random bytes (base64url) returned once;
only its SHA-256 hex is stored; 60-day expiry. Login lockout: 5 failures per key → lock 1 min, doubling up to 1 h.
Login ID rules: 3–60 chars, letters/digits/`._@+-` (an email, phone number or username). Password: 6–100 chars.

Functions (args always include `token` where auth is needed; `deviceId`, `deviceLabel` on session creation):
```
auth:signUp      (action)   {loginId, password, name, deviceId, deviceLabel} → {token, user}
auth:logIn       (action)   {loginId, password, deviceId, deviceLabel}       → {token, user}
auth:logOut      (mutation) {token}
auth:me          (query)    {token} → null | {user: {id, loginId, name}, kind, stallId?}
auth:changePassword (action){token, oldPassword, newPassword}               // signs out other sessions
auth:updateProfile (mutation){token, name}
stalls:list      (query)    {token} → [{id, code, name, booth, themeId, accent, heroArt, eventName, city, revision, snapshotAt,
                                        snapshotDevice, summary, hasTeamPassword, createdAt, updatedAt}]   (owner: own stalls; team session: its stall)
stalls:create    (mutation) {token, info: {name, booth, themeId, accent, heroArt, eventName, city}} → {id, code}
stalls:updateInfo(mutation) {token, stallId, info}
stalls:remove    (mutation) {token, stallId}          // owner only; deletes the snapshot file too
stalls:generateUploadUrl (mutation) {token} → url
stalls:commitSnapshot (mutation) {token, stallId, storageId, baseRevision, bytes, summary, info, device, force?}
                         → {ok: true, revision} | {ok: false, conflict: true, revision, snapshotAt, snapshotDevice}
                         // conflict when baseRevision !== stall.revision (unless force); a rejected upload is deleted
stalls:getSnapshot (query) {token, stallId} → null | {url, revision, snapshotAt, snapshotDevice, bytes}
stalls:setTeamPassword (action) {token, stallId, password | null}   // owner only; null removes team access
stalls:join      (action)   {code, password, deviceId, deviceLabel} → {token, stall: {id, code, name}}   // team session for one stall
```
Snapshot = the JSON produced by `exportBackup(state, media)` (includes photos), uploaded with an upload URL; downloads are
validated with `validateBackup` before use. Team sessions can list/get/commit only their stall and can't remove it or change
passwords.

### 17.4 Cloud client & sync (`dist/cloud.mjs`, owner: cloud agent)

No SDK: calls the Convex HTTP API with `fetch` — `POST ${CONVEX_URL}/api/{query|mutation|action}` with
`{path: 'stalls:list', args, format: 'json'}` → `{status: 'success', value}` | `{status: 'error', errorMessage, errorData}`
(user message = `errorData` when it is a string, else a generic message). Exports:
```js
cloudReady() → boolean (CONVEX_URL set) · session() → {token, user, kind, stallId} | null (localStorage 'mys-session')
signUp({loginId, password, name}) · logIn({loginId, password}) · logOut() · me() · changePassword(old, new) · updateName(name)
listCloudStalls() · linkStall(entryId)        // create in cloud + first push; entry.cloud set
pushStall(entryId, {force}) · pullStall(entryId | {cloudStallId}) → opens/updates a local entry
joinStall({code, password})                    // team session + download
setTeamPassword(entryId, password | null) · removeCloudStall(entryId)
startSync()                                    // subscribes to core.onCommitted; debounced push (4 s) of dirty linked stalls when
                                               // online + signed in; retries on 'online'; pushes on visibilitychange hidden
syncState(entryId) → status for the UI · onSyncChange(fn)
deviceId() (localStorage 'mys-device' uuid) · deviceLabel() ('Chrome on Android' etc.)
```
Conflict (cloud revision moved on another device): status 'conflict' — never auto-overwrite; UI offers **Use this device's
copy** (force push) or **Use the cloud copy** (download a local backup file first, then pull).

### 17.5 Pages (owners: landing agent, setup agent, stalls agent)

- **Landing `#/welcome`** (`ui/landing.mjs`, `css/landing.css`): a wild, joyful Neo-Brutalist marketing page — giant MYS
  sticker logo with "created by viraj", floating food-sticker collage (library art), punchy headline, CTAs **Start my stall**
  (`#/setup`), **Log in** (`#/login`), **Your stalls** (when the device has stalls), **Join a team stall** (`#/join`); feature
  grid (themes, UPI QR, tokens & kitchen queue, bills & payouts, offline, WhatsApp reports), "how it works" in 3 steps, a
  Stall's Collab COMING SOON teaser, footer. No fake testimonials or stats. Fast, responsive (320–1440), reduced-motion aware.
- **Setup wizard `#/setup`** (`ui/setup.mjs`, `css/setup.css`): full-page, one question per step, progress bar, Back/Next,
  Enter = next, everything optional except the stall name: 1 Name (stall name; stall/booth number **optional — "No stall
  number" skip**) → 2 What do you sell (6 themes + blank as hero cards; starter menu on/off; suggested prices on/off) → 3 Where &
  when (event, venue, city, date — skippable) → 4 Your team (owner name + partner names — skippable) → 5 Get paid (UPI ID +
  payee — skippable) → 6 Save to cloud (signed in: "Saved to your account"; signed out: create account / log in inline, or
  "Keep it on this phone only") → 7 Ready (confetti, summary card) → **Open my stall**. Creates the stall with
  `initialState({templateId, withPrices})` + `applyTheme` + profile/team/UPI + `onboarded: true` via `storage.createStall`,
  links it to the cloud when signed in.
- **Your stalls `#/stalls`** (`ui/stalls.mjs`, `css/stalls.css`): account card (signed in: name, login ID, Change password,
  Log out; signed out: Log in / Create account); "On this phone" stall cards (hero mini, name, booth, theme accent, orders,
  collected, last opened, sync badge) with **Open**, **Edit info** (name, booth optional, event, city, team members), **Team
  access** (code + set/remove team password, owner only), **Save to cloud** / **Sync now**, **Delete from this phone** (typed
  confirm; never deletes the cloud copy); "In your account, not on this phone" → **Download & open**; **+ Start a new stall**;
  **Join a team stall**. Conflict and error states explained in plain words.
- **Auth pages** (`ui/account.mjs`): `#/login`, `#/signup`, `#/join` (stall code + team password), `#/account` (name, change
  password, log out everywhere-ish = log out this device). Friendly validation, show/hide password, no PIN involved
  (the admin PIN stays a per-stall shared-phone guard).

### 17.6 As built (notes)

- The setup wizard creates stalls with `storage.createStall(state, {open: false})` and opens them only via `openStallById`, so
  another tab never has its active stall switched behind its back. Team-session tokens live separately in localStorage
  `mys-team`. A factory reset of a cloud-linked stall unlinks it on this phone, so the cloud copy can never be overwritten by
  an empty stall. JSON backups include only the current stall's photos (`storage.getMediaFor`).
- `auth:me` also returns `expiresAt` (and a `stall` object for team sessions); `stalls:updateInfo` returns the updated row;
  `stalls:setTeamPassword` returns `{hasTeamPassword}`. Extra indexes: `sessions.by_stall`, `stalls.by_snapshot`. An hourly
  cron deletes orphaned uploads, expired sessions and stale lockout rows.
- `dist/config.mjs`: local runs and tests use the dev deployment (descriptive-gull-970); the live site uses the production
  deployment (elegant-marlin-486). Deploy backend changes with `npx convex dev --once` (dev) and `npx convex deploy` (prod).
