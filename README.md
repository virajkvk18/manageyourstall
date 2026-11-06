# ManageYourStall (MYS)

**The offline-first point-of-sale and stall command center for temporary food & game stalls** — college fests, Diwali melas,
flea markets and pop-ups across India. Sell fast at rush hour, take Cash / UPI / Split, call out kitchen tokens, track every rupee
against your break-even, and send the day's numbers to your team on WhatsApp.

_created by viraj_ · Live: https://manageyourstall.vercel.app

MYS grew out of a single-stall app ("Packet Pataka · Stall No. 10", Diwali 2026). Everything that was hardcoded for that stall is
now yours to customize — name, booth, taglines, event, menu, categories, prices, visuals, discounts, investment, milestones, team.

---

## Highlights

- **6 pre-built stall themes** — Pataka Street Chaat & Snacks, Pizza & Fizz Hub, Chai/Coffee & Maggi Point, Momo & Fast-Food
  Corner, Sweet Tooth & Dessert Bar, Mela Games & Lucky Zone (or Blank): each sets a themed Neo-Brutalist hero illustration, a colour
  palette and an optional starter menu. Upload your own stall photo for the hero. Switch looks without touching your menu.
- **Customize My Stall (Studio)** — stall name, booth/stall number, hero tagline & sub-tagline, event, venue, city, date, owner/team
  & initials, accent + secondary colours, UPI ID, discount buttons, break-even mode, partners & cashiers, games, kitchen queue.
- **Expenses ledger with bill photos** — log every bill in seconds: title, category (Pre-Stall Setup, Mid-Stall Restock 🔄, Stall
  Rent / Registration, Packaging & Plates, Decor / Banner, Misc), amount, Cash/UPI, who paid (a partner or the stall cash drawer),
  a snapped photo of the bill and notes. **+ Quick mid-stall restock** from the Dashboard or Expenses. Every bill instantly raises the
  break-even target (*break-even = all bills*), so the progress bar, milestones and net profit (*revenue − all bills*) stay true.
- **Team "Contri" & profit splitter** — partners with colours and equal or custom profit shares; each partner's contri plus the bills
  they paid from their own pocket = what they put in; a live leaderboard; and a 1-tap **end-of-stall settlement**: step 1 pays back
  everyone's capital (proportionally if the stall made a loss), step 2 splits the pure profit, with a bold take-home card per person
  (exact to the paisa) and a WhatsApp-ready settlement report. Save settlement snapshots for the record.
- **Stall's Collab<sup>COMING SOON</sup>** — an interactive preview of stall-to-stall teamwork: cross-stall combo tokens that rescue
  quiet stalls, a deal-room chat, a booth exchange board, a mid-rush "Fest Lifeline" SOS for change/plates/ice, a collab match
  simulator and a feature poll.
- **Menu manager** — create / edit / duplicate / delete / reorder categories and items; sizes & variants; combos priced once with
  component stock; add-ons & flavours; tags (POP!, BESTSELLER, SPICY, NEW, COMBO, CHILLED); 1-tap **Sold out / In stock**.
- **Stall setup mode & price locks** — unpriced items stay locked and unsellable; batch-set prices on the Price board; lock prices
  against accidental edits; quick price edits on the fly.
- **Visual library** — 48 Neo-Brutalist illustrations of Indian stall favourites (samosa, pani puri, momos, maggi, pav bhaji, chai,
  kulhad chai, cold coffee, mojito, gulab jamun, ring toss, spin the wheel…), plus your own photo (compressed, stored offline) or an
  image link, with pastel tints and patterns.
- **Rush-hour selling** — search, category chips, Top sellers, steppers right on the cards, order notes, clear cart, Ctrl+Enter.
- **Review & pay** — 1-tap discount chips (₹ or %, with minimums) + custom discount; **Cash** with quick notes (Exact, ₹50, ₹100,
  ₹200, ₹500) and instant change; **UPI** with a scannable QR for the exact amount (`upi://pay?pa=…&pn=…&am=…&cu=INR`);
  **Split** (part cash, part UPI); pending "pay later" orders. MYS never claims to verify bank payments — the cashier confirms.
- **Tokens & kitchen queue** — every order gets a daily token (#01, #02…, resets each IST day or on demand); Preparing → Ready →
  Handed over board for the person at the stove.
- **Mission & profit mode** — break-even from your logged bills (recommended), or one total / a planned list plus bills; live
  recovery bar that flips to **PROFIT MODE 🔥**.
- **Built for every screen** — laptop (≥1024px): sidebar · workspace · sticky live cart; tablet (768–1023px): icon rail, 2-column
  grid, slide-over cart drawer; phone (<768px): brand bar, 1-thumb bottom nav and a floating "N items · ₹Total · Review & Pay →" bar
  that opens a full-screen order sheet. One 8/12/16/24/32px spacing scale everywhere.
- **Milestones** — editable and auto-generated (First sale, ₹1,000 Club, Halfway there, Break-even boss, ₹10,000 Dhamaka…), with
  honest reversal on refunds.
- **Day report** — WhatsApp-ready summary (revenue, investment, profit/recovery %, orders, top 3, Cash vs UPI) with Copy and
  Share to WhatsApp.
- **Data safety** — IndexedDB with atomic transactions, idempotent checkout, multi-tab safety, practice ledger, audit trail for every
  correction, CSV exports (itemized orders, order summary, payments, bills, contri, settlement), full JSON backup & validated restore
  (including bill and hero photos), and separate **Reset sales only**, **Reset today's orders** and **Factory reset** controls.
  Works fully offline after the first visit. (Data lives in IndexedDB — sturdier than localStorage for money records and photos.)

## Run locally

Requires Node.js 22+. No build step, no runtime dependencies — `dist/` is the app.

```sh
npm install
npm start            # http://127.0.0.1:4173
```

## Verify

```sh
npm run verify       # static checks + typecheck of the pure modules + unit tests
npx playwright install chromium   # once, if Chrome isn't installed
npm run test:browser # Playwright: desktop 1440, tablet 820, mobile 390, narrow 320
```

## Deploy

`dist/` is a static site. Vercel project `manageyourstall` deploys it directly (`vercel.json`: no build, `outputDirectory: dist`,
`sw.js` served without caching):

```sh
vercel deploy --prod --yes --project manageyourstall --scope virajs-projects-5f821631
```

Each origin (localhost, the Vercel URL, another host) has its own on-device data. Move a stall between devices or origins with
**More → Backup & exports → Download full backup**, then **Restore** on the other side.

## Upgrading from Packet Pataka (v1)

Opening MYS on a device that ran Packet Pataka migrates the saved data automatically and losslessly: every order, payment, refund,
game, expense, milestone, PIN and setting carries over (verified by fuzz tests that replay hundreds of v1 stall histories through the
original v1 code). Your stall keeps its name and menu; the new features are available immediately. A new service worker activates
after old tabs are closed (MYS shows an "Update" button instead of reloading mid-order).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) — the contract for the data model (schema v2), the pure modules (`domain`, `catalog`,
`templates`, `qr`, `library`), storage, the UI kernel, screens and the Neo-Brutalist design system.

```
dist/
  index.html · manifest.webmanifest · sw.js · icons · fonts
  util.mjs constants.mjs           shared helpers & vocabulary
  domain.mjs                       ledger, payments, tokens, reports, migration, backups (pure)
  catalog.mjs                      menu & settings editing + validation (pure)
  templates.mjs                    starter stall templates (pure data)
  qr.mjs                           QR encoder for UPI (pure)
  library.mjs art/*.mjs            visual library
  storage.mjs                      IndexedDB (state + photos)
  ui/core.mjs ui/shell.mjs         UI kernel, layout & branding
  ui/*.mjs css/*.css               feature screens
tests/                             node:test unit tests + Playwright specs
```

## Honest limits

- Single checkout device per stall: no cloud sync. Other phones keep their own separate data.
- UPI and "Other" payments are confirmed by the cashier; MYS does not talk to banks.
- The admin PIN is a shared-phone guard, not account security. There is no remote PIN recovery — keep backups.
- Clearing browser data or losing the phone loses records that weren't exported. Export backups regularly.

Fonts: Space Grotesk and Archivo Black (SIL Open Font License, see `licenses/`).
