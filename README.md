# Packet Pataka · Stall No. 10

A mobile-first, offline-oriented sales command center for the 4 November 2026 college Diwali celebration at Baderia Global Institute, Jabalpur. The investment-recovery target starts at **₹5,140**.

## Run locally

Requires Node.js 22+ (developed on Node 24). The application has no runtime framework, package CDN, backend, account service or API key. It is a small static ES-module app with IndexedDB. Development dependencies are only for tests.

```sh
npm install
npm start
```

Open http://127.0.0.1:4173. The production files are the contents of `dist/`; no build step is needed. The development server binds to loopback only. For a phone, deploy `dist/` to an HTTPS static host.

## Configure the stall

1. Open **More → Menu & prices**, create a local 4–8 digit admin PIN, and review prices.
2. Pizza bites, cold drinks and the two combo bundles deliberately start without prices. Set a price, or uncheck **Show on menu**. They cannot be sold while unpriced.
3. Edit packet sizes and add-ons separately. Corn/Cheese presets inherit the packet price and add each topping only once. Bundle prices replace component prices; composition determines stock usage.
4. **Stall settings** controls the target, promo amount/minimum, date, operator names, game fees and yellow accent. All amounts are INR.
5. **Stock room** optionally enables stock tracking. Enter total stocked units, including already consumed units. Pizza stock is measured in individual bites: the initial five-piece product consumes five.
6. Try **Practice counter**. It has its own clearly labelled orders, games, payments, draft and achievements. Load the provided sample orders or create your own. Menu/settings are shared between modes.
7. Return to **Event setup → Start live event**. All active products must have prices. A new installation has zero live records. Starting live does not delete existing sales; resetting requires a separate typed confirmation.

## Taking a sale

Tap a drink or preset to add immediately. Small/Large open a sheet for packet size, flavour, premium toppings and quantity. The cart is saved after each change and survives navigation/reload. Saved drafts retain their price snapshots; remove and re-add a line to use a new menu price.

Choose **Review & pay**, optionally apply the reel/banner promotion once, select Cash/UPI/Other, and complete the sale. UPI and Other require an explicit receipt confirmation. **The app does not process money or verify bank transactions.** The cash calculator is optional. Pending orders reserve stock but do not increase collected revenue; confirm payment later from the receipt.

The brief’s example: 2 small cheese packets (₹80), 1 large corn packet (₹50), 2 lemon sodas (₹40), minus one ₹10 promotion = **₹160**.

## Corrections, reporting and games

Open an order receipt, choose **Correct order**, unlock admin, enter a reason and confirm. A full or partial refund creates a negative payment against the original payment method. Void reverses any remaining collection and releases stock. Refunds do not put already prepared food back into stock. Receipts and corrections remain in the audit history.

Recorded collections are confirmed payments less refunds, including paid physical games. Pending orders and free games add no revenue. Game participation does not increase food-order counts. Reverse a mistaken game from the game history with admin confirmation.

Fully refunded/void orders are excluded from eligible order and item counts; partial refunds keep the original units because the refund is monetary rather than itemized. A bundle counts as one sold line unit but consumes its configured component stock. Gross item/category rankings are labelled separately from net collections. Promo totals show discounts granted on paid orders, including subsequently refunded orders. Hourly collections use payment/refund times in Asia/Kolkata.

Milestones respond to refunds and reversals. Original unlock timestamps remain visible. Money over ₹5,140 is **Above Recovery Target**, not exact profit. Expenses appear separately; collections less recorded expenses are not claimed as accounting profit. The initial investment is never automatically deducted a second time.

## Offline and data safety

- IndexedDB is the financial source of truth. A strict read/write transaction saves orders, payments, draft clearing, inventory implications and audit events together. Success is shown only after the transaction completes.
- Random UUIDs are idempotency keys. Repeated completion with the same key creates one order. Concurrent tabs serialize writes. A tab broadcast refreshes views; a changed cart must be reviewed again before payment.
- The service worker precaches the shell, local fonts, icons and code. **Visit online once and let the service worker finish before relying on offline use.** A device that has never loaded the app cannot open it without a network connection.
- Use the same browser profile and origin. Separate browsers, private windows, local preview and hosted deployment each have separate data.
- Request persistent storage in More, but browser approval is not guaranteed. Clearing browser data, eviction or losing the phone may remove records. JSON exports are essential.
- This is **single-checkout-device mode**. No multi-device synchronization, cloud backup, server queue or shared team ledger is implemented. Online does not mean synchronized.
- The local PIN is an accidental-change guard, not strong security or cloud authorization. There is no remote recovery for a forgotten PIN. Store the PIN securely; restore an appropriate backup only if you know its PIN.

## Backup and restore

More → Backup & exports provides itemized order CSV, payment-ledger CSV and a full JSON backup of both modes, catalog, settings, PIN hash and audit history. Export JSON regularly and before resets or moving devices. Keep it private.

Order-level totals repeat on every item row in the itemized CSV; **do not sum those repeated columns**. Use one row per order or the payments CSV to reconcile net collections. CSV text fields are escaped to reduce spreadsheet formula injection.

Restore validates backup totals and ledger references before asking for admin confirmation. Restoring replaces the device database atomically; it does not merge records. A backup from a different origin can be imported manually to move to the published site. Reset actions require exact typed confirmation.

## Tests and verification

```sh
npm run check
npm test
```

38 passing automated tests cover exact paise arithmetic, the requested ₹160 order, promos, variants, bundles, stock, pending payments, refunds, historical snapshots, idempotency, achievements, backup validation and IndexedDB transaction rollback/concurrency using `fake-indexeddb`.

Browser automation is provided for desktop (1440px), mobile (390px) and narrow (320px):

```sh
npx playwright install chromium
npm run test:browser
```

It covers checkout, explicit UPI confirmation, receipt/dashboard updates, persistence, pending payments, cart removal, offline reload and horizontal overflow. **These browser tests have not yet been run in this handoff because the browser preview permission gate declined access.** Actual mobile rendering, PWA installation and offline restart on the target phone still require verification. Unit tests are not a substitute for those checks.

Before event use, run the browser suite and rehearse the ₹160 order in Practice mode on the intended cashier phone. Test airplane-mode reload, save, reload again, a refund, and JSON restore on a separate browser profile. Return to live mode afterward.

## Deployment

Upload the contents of `dist/` to any HTTPS static host, keeping the relative file layout. No environment variables or backend setup are needed. Serve `.mjs`/`.js` as JavaScript and `.webmanifest` as JSON. `sw.js` should be served without long-lived HTTP caching. Bump the shell cache version when publishing asset updates. The new worker activates after old tabs close; avoid a forced update mid-order.

The `.openai/hosting.json` file retains this project’s Sites identity and static deployment directory. Source and deployment are packaged by the Sites workflow. The initial Site audience is owner-private; public/team sharing has not been enabled. A private hosting login may require connectivity before first use; test the installed app under actual event conditions.

## Structure

- `dist/domain.mjs`: pricing, transaction rules, ledger reports, stock and milestones.
- `dist/storage.mjs`: atomic IndexedDB adapter and same-origin tab notifications.
- `dist/app.mjs`: rendered screens, checkout, admin guard and exports.
- `dist/art.mjs`, `dist/style.css`: local vector illustrations, icons and responsive design.
- `dist/sw.js`, `manifest.webmanifest`: offline shell and installation metadata.
- `tests/`: automated domain/storage tests and browser acceptance suite.

## Design references

The supplied comic UI image informed the warm cream, Pataka pink, yellow, ink outlines, logo treatment and food illustrations. Art is implemented as lightweight local SVG. Fonts are Google Fonts’ Space Grotesk and Archivo Black, distributed under the SIL Open Font License (see `licenses/`).

Implementation references: [web.dev offline data](https://web.dev/learn/pwa/offline-data) and [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum/). Primary controls aim for 44px or larger; reduced-motion and keyboard focus styles are included.
