// Milestones (ARCHITECTURE.md §13.5) — owner: dashboard agent. No public actions (§11).
//
// Cards come from C().milestones (display order) with this ledger's unlock state S().milestones[id] and live progress
// from milestoneProgress(m, report). The editor (admin) adds, edits, deletes, reorders and auto-generates; every change
// re-evaluates both ledgers (refreshMilestones on st.live and st.demo) in the same commit.
import {
  C, S, esc, icon, render, btn, date, field, select, emptyState, registerScreen, registerActions, registerChanges, openSheet,
  closeSheet, confirmSheet, commitConfig, sheetEl, toast, paise,
} from './core.mjs';
import {report, milestoneProgress, refreshMilestones} from '../domain.mjs';
import {saveMilestone, deleteMilestone, moveMilestone, replaceMilestones, autoMilestones, CATALOG_LIMITS} from '../catalog.mjs';
import {MILESTONE_TYPES, LIMITS} from '../constants.mjs';
import {missionStrip, progressBar, milestoneCount} from './dashboard.mjs';

/** Edit mode shows the per-card tools (transient, per device). */
let editing = false;

const TYPE_ICON = {orders: 'receipt', revenue: 'rupee', recovery: 'target', items: 'box', games: 'game'};
const TYPE_LABEL = Object.fromEntries(MILESTONE_TYPES.map(t => [t.id, t.label]));

/** Target input copy by milestone type. @param {string} type */
function targetMeta(type) {
  if (type === 'revenue') return {label: 'Target (₹ collected)', hint: 'Money collected in this ledger, e.g. 2000.', mode: 'decimal', placeholder: '2000'};
  if (type === 'recovery') return {label: 'Target (% of break-even)', hint: '100 = break-even. Up to 1000%.', mode: 'numeric', placeholder: '50'};
  const unit = type === 'games' ? 'game plays' : type === 'items' ? 'items sold' : 'paid orders';
  return {label: `Target (${unit})`, hint: 'A whole number, e.g. 25.', mode: 'numeric', placeholder: '25'};
}

/** Stored target → input text (₹ for revenue). @param {{type: string, target: number}} m */
const targetText = m => (m.type === 'revenue' ? (m.target % 100 ? (m.target / 100).toFixed(2) : String(m.target / 100)) : String(m.target));

/** Input text → stored target. Money via paise(); counts/percent as whole numbers (catalog checks the range). */
function parseTarget(/** @type {string} */ type, /** @type {string} */ raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw Error('Set a target for this milestone.');
  if (type === 'revenue') return paise(text);
  const clean = text.replace(/,/g, '').replace(/%$/, '').trim();
  if (!/^\d+$/.test(clean)) throw Error(type === 'recovery' ? 'Use a whole percent, like 50 or 100.' : 'Use a whole number, like 25.');
  return Number(clean);
}

/** Re-evaluate both ledgers against the (new) milestone list. @param {any} st */
function refreshBoth(st) {
  refreshMilestones(st.live, st.config);
  refreshMilestones(st.demo, st.config);
}

// ---------------------------------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------------------------------

/** @param {any} m milestone @param {number} i index @param {any} r report @param {string|null} nextId */
function card(m, i, r, nextId) {
  const p = milestoneProgress(m, r);
  const st = S().milestones?.[m.id];
  const unlocked = st ? !!st.active : p.done;
  const reversed = !unlocked && !!st?.unlockedAt;
  const isNext = !unlocked && m.id === nextId;
  const state = unlocked ? 'is-unlocked' : reversed ? 'is-reversed' : isNext ? 'is-next' : 'is-locked';
  const eyebrow = unlocked ? `${icon('check')} UNLOCKED` : reversed ? 'REVERSED · KEEP GOING' : isNext ? `${icon('bolt')} UP NEXT` : 'TO UNLOCK';
  const foot = unlocked
    ? `<small class="ms-when">${icon('clock')} ${st?.unlockedAt ? `Unlocked ${esc(date(st.unlockedAt))}` : 'Unlocked'}</small>`
    : `<small class="ms-value"><strong>${esc(p.valueLabel)}</strong> / ${esc(p.goalLabel)}</small>`;
  // Recovery goals follow the break-even, which moves with every bill (§16.3): say why a card flipped back.
  const why = reversed
    ? `<p class="ms-why">${icon('info')} ${m.type === 'recovery' ? 'New bills raised your break-even — sell a little more to win it back.' : 'A refund or void took this one back — keep going.'}</p>`
    : '';
  const n = C().milestones.length;
  const tools = editing
    ? `<div class="ms-tools">
        ${btn(`${icon('edit')} Edit`, 'ms-edit', 'small', `data-id="${esc(m.id)}"`)}
        ${btn(icon('up'), 'ms-move', 'small icon-btn', `data-id="${esc(m.id)}" data-dir="-1" aria-label="Move ${esc(m.title)} up"${i === 0 ? ' disabled' : ''}`)}
        ${btn(icon('down'), 'ms-move', 'small icon-btn', `data-id="${esc(m.id)}" data-dir="1" aria-label="Move ${esc(m.title)} down"${i === n - 1 ? ' disabled' : ''}`)}
        ${btn(icon('trash'), 'ms-delete', 'small icon-btn danger', `data-id="${esc(m.id)}" aria-label="Delete ${esc(m.title)}"`)}
      </div>`
    : '';
  return `<li class="ms-card ${state}" data-milestone="${esc(m.id)}">
    <div class="ms-card-top">
      <span class="ms-symbol">${icon(unlocked ? 'check' : TYPE_ICON[m.type] || 'star')}</span>
      <div class="grow">
        <span class="ms-eyebrow">${eyebrow}</span>
        <h3>${esc(m.title)}</h3>
        <small class="ms-type">${esc(TYPE_LABEL[m.type] || m.type)} · goal ${esc(p.goalLabel)}</small>
      </div>
    </div>
    ${progressBar(p.ratio * 100, `${m.title} progress`, 'ms-progress')}
    ${foot}
    ${why}
    ${tools}
  </li>`;
}

function milestonesScreen() {
  const r = report(S(), C());
  const list = C().milestones;
  const {unlocked, total} = milestoneCount();
  const states = S().milestones || {};
  const next = list.find(m => !states[m.id]?.active && !milestoneProgress(m, r).done) || null;
  const right = `<span class="badge lime ms-count">${icon('trophy')} ${unlocked} / ${total} UNLOCKED</span>
    ${btn(editing ? `${icon('check')} Done` : `${icon('edit')} Edit list`, 'ms-edit-mode', editing ? 'small primary' : 'small', `aria-pressed="${editing}"`)}`;
  const toolbar = editing
    ? `<div class="ms-toolbar">
        ${btn(`${icon('plus')} Add milestone`, 'ms-add', 'small accent')}
        ${btn(`${icon('spark')} Auto-generate for my stall`, 'ms-auto', 'small lavender')}
        <span class="ms-toolbar-note">Changes need the admin PIN.</span>
      </div>`
    : '';
  const body = list.length
    ? `<ol class="ms-grid">${list.map((m, i) => card(m, i, r, next?.id ?? null)).join('')}</ol>`
    : emptyState('trophy', 'No milestones yet', 'Add a few goals for the team — first sale, ₹1,000 club, break-even.',
      btn(`${icon('plus')} Add milestone`, 'ms-add', 'accent') + btn(`${icon('spark')} Auto-generate`, 'ms-auto', 'lavender'));
  return `<div class="ms">
    <div class="screen-heading"><div class="grow"><h1>Small sparks. Big wins.</h1><p>Goals that keep the whole team buzzing.</p></div><div class="screen-heading-right">${right}</div></div>
    ${missionStrip(r)}
    ${toolbar}
    ${body}
    <p class="footnote ms-foot">Milestones follow paid orders, games and bills in this ledger. Recovery goals move with your break-even, so a refund, a void or a big new bill can reverse one — the first unlock time is kept. Orders count service, not unique people.</p>
  </div>`;
}

registerScreen('milestones', milestonesScreen);

// ---------------------------------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string|null} id */
function openEditor(id) {
  const existing = id ? C().milestones.find(m => m.id === id) : null;
  if (id && !existing) throw Error('That milestone no longer exists.');
  const m = existing || {id: '', title: '', type: 'orders', target: 0};
  const meta = targetMeta(m.type);
  const types = MILESTONE_TYPES.map(t => /** @type {[string, string]} */ ([t.id, t.label]));
  openSheet(
    existing ? 'Edit milestone' : 'New milestone',
    `<form class="ms-form" data-submit="ms-save" data-id="${esc(m.id)}">
      ${field('Title', 'ms-title', m.title, 'text', `maxlength="${LIMITS.milestoneTitle}" autocomplete="off" placeholder="e.g. 100 plates club"${existing ? '' : ' autofocus'}`)}
      ${select('What counts?', 'ms-type', types, m.type, 'data-change="ms-type"')}
      ${field(meta.label, 'ms-target', existing ? targetText(m) : '', 'text', `inputmode="${meta.mode}" autocomplete="off" placeholder="${meta.placeholder}"`, meta.hint)}
      <p class="footnote">Recovery goals use your break-even — every bill you log (plus your planned investment, if you set one). Max ${CATALOG_LIMITS.milestones} milestones.</p>
    </form>`,
    btn('Cancel', 'close', 'quiet-outline') + btn(`${icon('check')} Save milestone`, 'ms-save', 'primary', `data-id="${esc(m.id)}"`),
    'ms-editor',
  );
}

registerChanges({
  // Retune the target field's label, keyboard and hint to the chosen unit without rebuilding the form.
  'ms-type': el => {
    const sheet = sheetEl();
    const meta = targetMeta(el.value);
    const label = sheet?.querySelector('label[for="ms-target"]');
    const input = /** @type {HTMLInputElement|null} */ (sheet?.querySelector('#ms-target'));
    const hint = sheet?.querySelector('#ms-target-hint');
    if (label) label.textContent = meta.label;
    if (input) {
      input.inputMode = meta.mode;
      input.placeholder = meta.placeholder;
    }
    if (hint) hint.textContent = meta.hint;
  },
});

registerActions(
  {
    'ms-edit-mode': () => {
      editing = !editing;
      render();
    },
    'ms-add': () => openEditor(null),
    'ms-edit': (_el, ds) => openEditor(ds.id || null),
    'ms-save': async (_el, ds) => {
      const sheet = sheetEl();
      const form = sheet?.querySelector('.ms-form');
      if (!form) return;
      const value = (/** @type {string} */ sel) => /** @type {HTMLInputElement|null} */ (form.querySelector(sel))?.value ?? '';
      const type = value('#ms-type');
      const data = {title: value('#ms-title'), type, target: parseTarget(type, value('#ms-target'))};
      const id = ds.id || /** @type {HTMLElement} */ (form).dataset.id || '';
      const saved = await commitConfig(st => {
        const before = id ? st.config.milestones.find((/** @type {any} */ x) => x.id === id) : null;
        const m = saveMilestone(st.config, id ? {...data, id} : data);
        // A new goal (type or target changed) starts fresh; otherwise a raised target would read "REVERSED".
        if (before && (before.type !== m.type || before.target !== m.target)) {
          for (const s of [st.live, st.demo]) if (s.milestones) delete s.milestones[m.id];
        }
        refreshBoth(st);
        return m;
      });
      closeSheet();
      toast(id ? `“${saved.title}” updated.` : `“${saved.title}” added. Go get it!`);
    },
    'ms-move': async (_el, ds) => {
      const dir = ds.dir === '-1' ? -1 : 1;
      await commitConfig(st => {
        moveMilestone(st.config, ds.id, dir);
        refreshBoth(st);
      });
      // The re-render dropped focus; follow the moved card (or its other arrow once it hits the end).
      const card = document.querySelector(`.ms-card[data-milestone="${CSS.escape(ds.id || '')}"]`);
      const same = /** @type {HTMLButtonElement|null|undefined} */ (card?.querySelector(`[data-action="ms-move"][data-dir="${dir}"]`));
      const other = /** @type {HTMLButtonElement|null|undefined} */ (card?.querySelector(`[data-action="ms-move"][data-dir="${-dir}"]`));
      (same && !same.disabled ? same : other)?.focus();
    },
    'ms-delete': (_el, ds) => {
      const m = C().milestones.find(x => x.id === ds.id);
      if (!m) throw Error('That milestone no longer exists.');
      confirmSheet({
        title: 'Delete this milestone?',
        body: `<p><strong>${esc(m.title)}</strong> leaves the list. Sales and money stay exactly as they are.</p>`,
        confirmLabel: 'Delete milestone',
        danger: true,
        onConfirm: async () => {
          await commitConfig(st => {
            deleteMilestone(st.config, m.id);
            refreshBoth(st);
          });
          toast('Milestone deleted.');
        },
      });
    },
    'ms-auto': () => {
      const preview = autoMilestones(C());
      confirmSheet({
        title: 'Auto-generate milestones?',
        body: `<p>We’ll replace your ${C().milestones.length} milestone${C().milestones.length === 1 ? '' : 's'} with ${preview.length} goals sized to your stall:</p>
          <ul class="ms-preview">${preview.map(m => `<li>${icon(TYPE_ICON[m.type] || 'star')} <span>${esc(m.title)}</span></li>`).join('')}</ul>
          <p class="muted">Unlock times start fresh for the new list. Sales and money stay untouched.</p>`,
        confirmLabel: 'Replace milestones',
        onConfirm: async () => {
          await commitConfig(st => {
            replaceMilestones(st.config, autoMilestones(st.config));
            refreshBoth(st);
          });
          toast('Fresh milestones ready. Let’s go!');
        },
      });
    },
  },
  {admin: ['ms-add', 'ms-edit', 'ms-save', 'ms-move', 'ms-delete', 'ms-auto']},
);
