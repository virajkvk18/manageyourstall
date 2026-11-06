// Visual picker (ARCHITECTURE.md §13.7): choose how a menu item looks — a library illustration, an uploaded photo
// (stored on this device), a web image link, plus the card tint and pattern.
//
// openPicker() takes over the shared #sheet (wide) and NEVER commits state: "Use this" hands the selection to onDone and the
// caller (menu editor) commits it. Cancel / close / Escape call onCancel. Uploads are written to the media store right away
// (that is how they get a 'media:<id>' reference); uploads that end up unused are removed again when the picker closes, and
// anything left unreferenced is pruned on the next boot anyway.
import {
  esc, icon, btn, artFrame, openSheet, closeSheet, sheetEl, sheetKind, showError, saveImageDataUrl,
  registerActions, registerInputs, registerChanges,
} from './core.mjs';
import {deleteMedia} from '../storage.mjs';
import {ART, ART_GROUPS, artSvg, searchArt, hasArt, FALLBACK_ART} from '../library.mjs';
import {TINTS, PATTERNS, TINT_IDS, PATTERN_IDS, MEDIA_RE, IMAGE_URL_RE, LIMITS} from '../constants.mjs';
import {uuid} from '../util.mjs';

/** Longest side of an uploaded photo after downscaling (px). */
export const UPLOAD_MAX_SIDE = 320;
/** Largest stored upload (decoded bytes). */
export const UPLOAD_MAX_BYTES = 150 * 1024;
/** Files bigger than this are refused before decoding (bytes). */
const UPLOAD_MAX_INPUT = 30 * 1024 * 1024;
const QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5, 0.4, 0.3];

const TABS = /** @type {const} */ ([
  {id: 'library', label: 'Library', icon: 'grid'},
  {id: 'upload', label: 'Upload', icon: 'upload'},
  {id: 'link', label: 'Link', icon: 'link'},
  {id: 'style', label: 'Style', icon: 'palette'},
]);

/** @typedef {'library'|'upload'|'link'|'style'} TabId */
/** @typedef {{art: string, image: string|null, tint: string, pattern: string}} Selection */
/**
 * @typedef {{
 *   token: string, name: string, art: string, image: string|null, tint: string, pattern: string,
 *   tab: TabId, query: string, group: string,
 *   url: string, linkState: 'idle'|'loading'|'ok'|'error', restore: string|null,
 *   busy: boolean, uploadNote: string, uploadError: string, uploads: string[],
 *   finished: boolean, onDone: (sel: Selection) => any, onCancel?: () => any,
 * }} PickerState
 */

/** The open picker (null when closed). @type {PickerState|null} */
let pk = null;
let linkTimer = 0;

const isLink = (/** @type {string|null} */ ref) => typeof ref === 'string' && ref.startsWith('https://');
const isMedia = (/** @type {string|null} */ ref) => typeof ref === 'string' && MEDIA_RE.test(ref);

/** The picker that is on screen right now (its markup is in the open sheet), else null. */
function live() {
  const p = pk;
  if (!p || p.finished || sheetKind() !== 'picker') return null;
  return sheetEl()?.querySelector(`.pick-wrap[data-pick="${p.token}"]`) ? p : null;
}

/** @param {string} sel */
const q = sel => /** @type {HTMLElement|null} */ (sheetEl()?.querySelector(sel) ?? null);

/** Hide a stale error from an earlier "Use this" once the person changes something. */
function clearError() {
  const slot = q('.sheet-body > [data-error]');
  if (slot && !slot.hidden) {
    slot.hidden = true;
    slot.textContent = '';
  }
}

/** @param {PickerState} p @returns {Selection} */
const selectionOf = p => ({art: p.art, image: p.image, tint: p.tint, pattern: p.pattern});

/**
 * Open the visual picker in the shared sheet (replacing whatever it shows). Never commits state.
 * @param {{art?: string, image?: string|null, tint?: string, pattern?: string, name?: string}} current
 * @param {(selection: Selection) => any} onDone called once with {art, image, tint, pattern} on "Use this"
 * @param {{onCancel?: () => any, title?: string}} [options] onCancel runs on Cancel / close / Escape (never after onDone);
 *   title is plain text (escaped here)
 */
export function openPicker(current, onDone, {onCancel, title} = {}) {
  const cur = current || {};
  const image = isMedia(cur.image ?? null) || (typeof cur.image === 'string' && IMAGE_URL_RE.test(cur.image)) ? /** @type {string} */ (cur.image) : null;
  /** @type {PickerState} */
  const p = {
    token: uuid().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16),
    name: String(cur.name || '').trim(),
    art: typeof cur.art === 'string' && cur.art ? cur.art : FALLBACK_ART,
    image,
    tint: TINT_IDS.includes(cur.tint || '') ? /** @type {string} */ (cur.tint) : 'cream',
    pattern: PATTERN_IDS.includes(cur.pattern || '') ? /** @type {string} */ (cur.pattern) : 'none',
    tab: isMedia(image) ? 'upload' : isLink(image) ? 'link' : 'library',
    query: '',
    group: '',
    url: isLink(image) ? /** @type {string} */ (image) : '',
    linkState: isLink(image) ? 'loading' : 'idle',
    restore: isMedia(image) ? image : null,
    busy: false,
    uploadNote: '',
    uploadError: '',
    uploads: [],
    finished: false,
    onDone,
    onCancel,
  };
  pk = p;
  clearTimeout(linkTimer);
  const heading = esc(String(title || '').trim() || 'Pick a look');
  const body = `<div class="pick-wrap" data-pick="${p.token}">
    <div class="pick-side"><div class="pick-preview" id="pick-preview" aria-live="polite">${previewHtml(p)}</div></div>
    <div class="pick-main">
      <div class="pick-tabs" role="tablist" aria-label="Ways to pick a look">${tabsHtml(p)}</div>
      <div class="pick-panel" id="pick-panel" role="tabpanel" aria-labelledby="pick-tab-${p.tab}" tabindex="-1">${panelHtml(p)}</div>
    </div>
  </div>`;
  const actions = btn('Cancel', 'pick-cancel', 'quiet-outline') + btn(`${icon('check')}Use this`, 'pick-done', 'primary pick-use');
  openSheet(heading, body, actions, 'picker', {
    wide: true,
    onClose: () => {
      clearTimeout(linkTimer);
      if (pk === p) pk = null;
      if (p.finished) return;
      p.finished = true;
      dropUploads(p, null);
      p.onCancel?.();
    },
  });
  afterPanel(p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} id */
const artLabel = id => (hasArt(id) ? ART[id].label : 'Classic packet');
/** @param {string} id */
const tintLabel = id => TINTS.find(t => t.id === id)?.label || id;
/** @param {string} id */
const patternLabel = id => PATTERNS.find(x => x.id === id)?.label || id;

/** @param {PickerState} p */
function sourceBadge(p) {
  if (isMedia(p.image)) return `<span class="badge mint pick-source">${icon('image')}Your photo</span>`;
  if (isLink(p.image)) return `<span class="badge sky pick-source">${icon('link')}Web link</span>`;
  return `<span class="badge yellow pick-source">${icon('spark')}Illustration</span>`;
}

/** @param {PickerState} p */
function previewHtml(p) {
  const name = p.name || 'Your item';
  const note = isMedia(p.image)
    ? 'Stored on this device · works offline'
    : isLink(p.image)
      ? 'Needs internet — the illustration shows when offline'
      : 'Drawn in, works offline';
  return `${artFrame({art: p.art, image: p.image, tint: p.tint, pattern: p.pattern}, {size: 'lg', cls: 'pick-preview-art'})}
    <div class="pick-preview-text">
      ${sourceBadge(p)}
      <strong class="pick-preview-name">${esc(name)}</strong>
      <span class="pick-preview-meta">${esc(artLabel(p.art))} art · ${esc(tintLabel(p.tint))} · ${esc(patternLabel(p.pattern))}</span>
      <span class="pick-preview-note">${esc(note)}</span>
    </div>`;
}

/** @param {PickerState} p */
function tabsHtml(p) {
  return TABS.map(t => {
    const on = t.id === p.tab;
    return `<button type="button" class="pick-tab${on ? ' active' : ''}" role="tab" id="pick-tab-${t.id}" aria-controls="pick-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-action="pick-tab" data-tab="${t.id}"${on ? ' autofocus' : ''}>${icon(t.icon)}<span>${t.label}</span></button>`;
  }).join('');
}

/** @param {PickerState} p */
function panelHtml(p) {
  if (p.tab === 'upload') return uploadHtml(p);
  if (p.tab === 'link') return linkHtml(p);
  if (p.tab === 'style') return styleHtml(p);
  return libraryHtml(p);
}

/** @param {PickerState} p @param {string} text */
function photoNotice(p, text) {
  if (!p.image) return '';
  return `<div class="notice sky pick-photo-note">${icon('info')}<div class="grow">${esc(text)}</div>${btn(`${icon('trash')}Remove photo`, 'pick-remove-photo', 'small quiet-outline')}</div>`;
}

/** @param {PickerState} p */
function libraryHtml(p) {
  const chips = [{id: '', label: 'All'}, ...ART_GROUPS].map(g =>
    `<button type="button" class="chip pick-group${p.group === g.id ? ' active' : ''}" data-action="pick-group" data-group="${esc(g.id)}" aria-pressed="${p.group === g.id}">${esc(g.label)}</button>`,
  ).join('');
  return `${photoNotice(p, 'Your photo is showing. Tap any illustration to switch back to art.')}
    <div class="pick-search">
      <label for="pick-search" class="sr-only">Search illustrations</label>
      ${icon('search', 'pick-search-icon')}
      <input id="pick-search" class="input" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" spellcheck="false" maxlength="40" placeholder="Search samosa, chai, pizza…" value="${esc(p.query)}" data-input="pick-search">
    </div>
    <div class="pick-groups" role="group" aria-label="Filter by group">${chips}</div>
    <div id="pick-results">${resultsHtml(p)}</div>`;
}

/** @param {PickerState} p */
function resultsHtml(p) {
  const list = searchArt(p.query, p.group);
  if (!list.length) {
    return `<div class="pick-empty">${icon('search')}<p><strong>No art for “${esc(p.query)}”.</strong> Try “chai”, “fries” or “pizza” — or upload your own photo.</p>${btn('Clear search', 'pick-clear-search', 'small')}</div>`;
  }
  const tiles = list.map(a => {
    const on = a.id === p.art && !p.image;
    return `<button type="button" class="pick-art${on ? ' active' : ''}" data-action="pick-art" data-art="${esc(a.id)}" aria-pressed="${on}">
      <span class="pick-art-thumb tint-${p.tint}" aria-hidden="true">${artSvg(a.id, 'food-art')}</span><span class="pick-art-label">${esc(a.label)}</span>
      <span class="pick-art-check" aria-hidden="true">${icon('check')}</span></button>`;
  }).join('');
  return `<p class="pick-count" role="status">${list.length} illustration${list.length === 1 ? '' : 's'}</p><div class="pick-grid">${tiles}</div>`;
}

/** @param {PickerState} p */
function uploadHtml(p) {
  const status = p.busy
    ? `<div class="notice pick-upload-status" role="status">${icon('refresh', 'pick-spin')}<div><strong>Shrinking your photo…</strong> Making it light enough for a cheap phone.</div></div>`
    : p.uploadError
      ? `<div class="notice danger pick-upload-status" role="alert">${icon('alert')}<div>${esc(p.uploadError)}</div></div>`
      : '';
  const current = isMedia(p.image)
    ? `<div class="pick-upload-current" role="status">${artFrame({art: p.art, image: p.image, tint: p.tint, pattern: p.pattern}, {size: 'sm'})}<div class="grow"><strong>${p.uploadNote ? 'Photo saved!' : 'Your photo is set'}</strong><small>${esc(p.uploadNote || 'Pick another file to replace it.')}</small></div>${btn(`${icon('trash')}Remove`, 'pick-remove-photo', 'small quiet-outline')}</div>`
    : '';
  return `<label class="pick-drop${p.busy ? ' busy' : ''}" for="pick-file">
      <span class="pick-drop-icon" aria-hidden="true">${icon('upload')}</span>
      <span class="pick-drop-text"><strong>${isMedia(p.image) ? 'Choose a different photo' : 'Choose a photo'}</strong><small>Camera or gallery · JPG, PNG, WebP</small></span>
    </label>
    <input id="pick-file" class="sr-only" type="file" accept="image/*" data-change="pick-file"${p.busy ? ' disabled' : ''}>
    ${status}${current}
    <p class="pick-footnote">${icon('phone')}<span><strong>Stored on this device · works offline.</strong> We shrink it to ${UPLOAD_MAX_SIDE}px so the counter stays fast. It travels with JSON backups.</span></p>`;
}

/** @param {string} url @returns {string} '' when fine */
function linkProblem(url) {
  const v = url.trim();
  if (!v) return '';
  if (/\s/.test(v)) return 'Links can’t contain spaces. Copy the image address again.';
  if (/^http:\/\//i.test(v)) return 'Use a secure https:// link — plain http images get blocked.';
  if (!/^https:\/\//i.test(v)) return 'Paste the full image address, starting with https://';
  if (v.length > LIMITS.imageUrl) return `That link is too long (max ${LIMITS.imageUrl} characters).`;
  if (!/^https:\/\//.test(v) || !IMAGE_URL_RE.test(v)) return 'That doesn’t look like an image link. Check it and try again.';
  return '';
}

/** @param {PickerState} p */
function linkHtml(p) {
  const problem = linkProblem(p.url);
  return `<div class="field pick-url-field">
      <label for="pick-url">Image link</label>
      <input id="pick-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${LIMITS.imageUrl + 8}" placeholder="https://…/samosa.jpg" value="${esc(p.url)}" data-input="pick-url" aria-describedby="pick-url-msg"${problem ? ' aria-invalid="true"' : ''}>
      <small id="pick-url-msg" class="pick-url-msg${problem ? ' bad' : ''}">${esc(problem || 'Right-click / long-press an image online → “Copy image address”.')}</small>
    </div>
    <div class="pick-link-preview" id="pick-link-preview" data-state="${linkStateOf(p)}">${linkPreviewHtml(p)}</div>
    <div class="notice pick-link-warn">${icon('wifi-off')}<div><strong>Needs internet — the illustration shows when offline.</strong> Uploading a photo works offline.</div></div>`;
}

/** @param {PickerState} p */
const linkStateOf = p => (!p.url.trim() ? 'idle' : linkProblem(p.url) ? 'invalid' : p.linkState);

/** @param {PickerState} p */
function linkPreviewHtml(p) {
  const st = linkStateOf(p);
  if (st === 'idle') return `<div class="pick-link-msg">${icon('image')}<span>Paste a link to see it here.</span></div>`;
  if (st === 'invalid') return `<div class="pick-link-msg">${icon('alert')}<span>Fix the link to see a preview.</span></div>`;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const msg = st === 'ok'
    ? `${icon('check')}<span>Looks good!</span>`
    : st === 'error'
      ? `${icon('alert')}<span>${offline ? 'You’re offline — it will load when you’re back online.' : 'Couldn’t load that image. Check the link, or upload the photo instead.'}</span>`
      : `${icon('refresh', 'pick-spin')}<span>Loading preview…</span>`;
  return `<img class="pick-link-img" src="${esc(p.url.trim())}" alt="Preview of the linked image" referrerpolicy="no-referrer" decoding="async"${st === 'ok' ? '' : ' hidden'}>
    <div class="pick-link-msg" role="status">${msg}</div>`;
}

/** @param {PickerState} p */
function styleHtml(p) {
  const tints = TINTS.map(t => {
    const on = t.id === p.tint;
    return `<button type="button" class="pick-swatch${on ? ' active' : ''}" data-action="pick-tint" data-tint="${t.id}" aria-pressed="${on}">
      <span class="pick-swatch-chip" style="background:${t.hex}" aria-hidden="true"></span><span class="pick-swatch-label">${esc(t.label)}</span></button>`;
  }).join('');
  const patterns = PATTERNS.map(x => {
    const on = x.id === p.pattern;
    return `<button type="button" class="pick-swatch${on ? ' active' : ''}" data-action="pick-pattern" data-pattern="${x.id}" aria-pressed="${on}">
      <span class="pick-swatch-chip pick-swatch-pattern tint-${p.tint} pattern-${x.id}" aria-hidden="true"></span><span class="pick-swatch-label">${esc(x.label)}</span></button>`;
  }).join('');
  return `${photoNotice(p, 'Your photo covers the background. Tint and pattern show behind the illustration if the photo can’t load.')}
    <h3 class="pick-label" id="pick-tint-label">Background colour</h3>
    <div class="pick-swatches" role="group" aria-labelledby="pick-tint-label">${tints}</div>
    <h3 class="pick-label" id="pick-pattern-label">Pattern</h3>
    <div class="pick-swatches" role="group" aria-labelledby="pick-pattern-label">${patterns}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Partial updates (the sheet is opened once; scroll position and focus stay put)
// ---------------------------------------------------------------------------------------------------------------------

/** @param {PickerState} p */
function refreshPreview(p) {
  clearError();
  const el = q('#pick-preview');
  if (el) el.innerHTML = previewHtml(p);
}

/** @param {PickerState} p @param {{focusTab?: boolean}} [opts] */
function refreshPanel(p, {focusTab = false} = {}) {
  clearError();
  const tabs = q('.pick-tabs');
  if (tabs) tabs.innerHTML = tabsHtml(p).replace(/ autofocus/g, '');
  const panel = q('#pick-panel');
  if (panel) {
    panel.setAttribute('aria-labelledby', `pick-tab-${p.tab}`);
    panel.innerHTML = panelHtml(p);
  }
  if (focusTab) q(`#pick-tab-${p.tab}`)?.focus();
  afterPanel(p);
}

/** @param {PickerState} p */
function refreshResults(p) {
  const el = q('#pick-results');
  if (el) el.innerHTML = resultsHtml(p);
  sheetEl()?.querySelectorAll('.pick-group').forEach(chip => {
    const on = /** @type {HTMLElement} */ (chip).dataset.group === p.group;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
}

/** Wire things innerHTML can't (image load/error for the link preview). @param {PickerState} p */
function afterPanel(p) {
  if (p.tab === 'link') wireLinkImage(p);
}

/** @param {PickerState} p */
function wireLinkImage(p) {
  const img = /** @type {HTMLImageElement|null} */ (q('.pick-link-img'));
  if (!img) return;
  const url = img.getAttribute('src') || '';
  const settle = (/** @type {'ok'|'error'} */ st) => {
    if (live() !== p || p.url.trim() !== url || p.linkState === st) return;
    p.linkState = st;
    const box = q('#pick-link-preview');
    if (!box) return;
    box.dataset.state = st;
    img.hidden = st !== 'ok';
    const msg = box.querySelector('.pick-link-msg');
    if (msg) {
      msg.innerHTML = st === 'ok'
        ? `${icon('check')}<span>Looks good!</span>`
        : `${icon('alert')}<span>${navigator.onLine === false ? 'You’re offline — it will load when you’re back online.' : 'Couldn’t load that image. Check the link, or upload the photo instead.'}</span>`;
    }
  };
  if (img.complete && img.naturalWidth > 0) settle('ok');
  else if (img.complete && url) settle('error');
  img.addEventListener('load', () => settle('ok'));
  img.addEventListener('error', () => settle('error'));
}

/** Point the live <img> preview at the current link (debounced while typing). @param {PickerState} p */
function scheduleLinkPreview(p) {
  clearTimeout(linkTimer);
  const box = q('#pick-link-preview');
  const st = linkStateOf(p);
  if (box && (st === 'idle' || st === 'invalid')) {
    box.dataset.state = st;
    box.innerHTML = linkPreviewHtml(p);
    return;
  }
  linkTimer = window.setTimeout(() => {
    if (live() !== p) return;
    refreshPreview(p);
    const el = q('#pick-link-preview');
    if (!el) return;
    el.dataset.state = linkStateOf(p);
    el.innerHTML = linkPreviewHtml(p);
    wireLinkImage(p);
  }, 300);
}

// ---------------------------------------------------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------------------------------------------------

/** Apply the link field to the selection: a valid link becomes the image; clearing it brings back the earlier photo. @param {PickerState} p */
function applyLink(p) {
  const v = p.url.trim();
  if (v && !linkProblem(v)) {
    if (!isLink(p.image)) p.restore = p.image;
    if (p.image !== v) p.linkState = 'loading';
    p.image = v;
  } else if (isLink(p.image)) {
    p.image = p.restore;
  }
}

/** @param {PickerState} p @param {string|null} keep media ref to keep */
function dropUploads(p, keep) {
  const ids = p.uploads.filter(ref => ref !== keep).map(ref => ref.slice(6));
  p.uploads = keep && p.uploads.includes(keep) ? [keep] : [];
  if (ids.length) deleteMedia(ids).catch(err => console.warn('Could not tidy unused photos', err));
}

/** @param {HTMLElement} el @param {string} attr @param {string} value */
function pressInPlace(el, attr, value) {
  const group = el.parentElement;
  group?.querySelectorAll(`[${attr}]`).forEach(b => {
    const on = b.getAttribute(attr) === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

const tabOrder = TABS.map(t => t.id);

/** @param {PickerState} p @param {string} tab @param {boolean} [focusTab] */
function switchTab(p, tab, focusTab = false) {
  if (!tabOrder.includes(/** @type {TabId} */ (tab))) return;
  p.tab = /** @type {TabId} */ (tab);
  refreshPanel(p, {focusTab});
  const body = sheetEl()?.querySelector('.sheet-body');
  const main = q('.pick-main');
  // On phones the panel sits below the preview: bring the tab bar back into view when the panel was scrolled away.
  if (body && main && body.scrollTop > main.offsetTop) body.scrollTo?.({top: main.offsetTop - 8});
}

registerActions({
  'pick-tab': (_el, ds) => {
    const p = live();
    if (p) switchTab(p, ds.tab || 'library');
  },
  'pick-group': (_el, ds) => {
    const p = live();
    if (!p) return;
    p.group = ds.group || '';
    refreshResults(p);
  },
  'pick-clear-search': () => {
    const p = live();
    if (!p) return;
    p.query = '';
    p.group = '';
    const input = /** @type {HTMLInputElement|null} */ (q('#pick-search'));
    if (input) input.value = '';
    refreshResults(p);
    input?.focus();
  },
  'pick-art': (el, ds) => {
    const p = live();
    if (!p || !ds.art || !hasArt(ds.art)) return;
    p.art = ds.art;
    p.image = null;
    p.restore = null;
    p.url = '';
    p.linkState = 'idle';
    p.uploadNote = '';
    if (el) pressInPlace(el, 'data-art', ds.art);
    q('.pick-photo-note')?.remove();
    refreshPreview(p);
  },
  'pick-tint': (el, ds) => {
    const p = live();
    if (!p || !TINT_IDS.includes(ds.tint || '')) return;
    p.tint = /** @type {string} */ (ds.tint);
    if (el) pressInPlace(el, 'data-tint', p.tint);
    sheetEl()?.querySelectorAll('.pick-swatch-pattern').forEach(chip => {
      chip.className = chip.className.replace(/\btint-[a-z]+\b/, `tint-${p.tint}`);
    });
    refreshPreview(p);
  },
  'pick-pattern': (el, ds) => {
    const p = live();
    if (!p || !PATTERN_IDS.includes(ds.pattern || '')) return;
    p.pattern = /** @type {string} */ (ds.pattern);
    if (el) pressInPlace(el, 'data-pattern', p.pattern);
    refreshPreview(p);
  },
  'pick-remove-photo': () => {
    const p = live();
    if (!p) return;
    p.image = null;
    p.restore = null;
    p.url = '';
    p.linkState = 'idle';
    p.uploadNote = '';
    p.uploadError = '';
    refreshPanel(p);
    refreshPreview(p);
  },
  'pick-cancel': () => closeSheet(),
  'pick-done': () => {
    const p = live();
    if (!p) return;
    if (p.busy) throw Error('Hang on — your photo is still saving.');
    const input = /** @type {HTMLInputElement|null} */ (q('#pick-url'));
    if (input) p.url = input.value;
    if (p.tab === 'link') {
      const problem = linkProblem(p.url);
      if (problem) {
        input?.focus();
        throw Error(problem);
      }
      applyLink(p);
    }
    const sel = selectionOf(p);
    p.finished = true;
    try {
      const out = p.onDone(sel);
      if (out && typeof out.then === 'function') out.catch(showError);
    } catch (err) {
      p.finished = false;
      throw err;
    }
    dropUploads(p, sel.image);
    if (pk === p) pk = null;
    // onDone usually reopens the caller's sheet (which replaces ours); otherwise close the picker now.
    if (sheetKind() === 'picker' && sheetEl()?.querySelector(`.pick-wrap[data-pick="${p.token}"]`)) closeSheet();
  },
});

registerInputs({
  'pick-search': el => {
    const p = live();
    if (!p) return;
    p.query = String(el.value || '').slice(0, 40);
    refreshResults(p);
  },
  'pick-url': el => {
    const p = live();
    if (!p) return;
    p.url = String(el.value || '');
    const problem = linkProblem(p.url);
    el.setAttribute('aria-invalid', problem ? 'true' : 'false');
    const msg = q('#pick-url-msg');
    if (msg) {
      msg.textContent = problem || 'Right-click / long-press an image online → “Copy image address”.';
      msg.classList.toggle('bad', !!problem);
    }
    applyLink(p);
    // A valid link is fetched by the preview card too: wait until typing pauses (scheduleLinkPreview) so a typed link
    // doesn't fire one image request per keystroke.
    const st = linkStateOf(p);
    if (st === 'idle' || st === 'invalid') refreshPreview(p);
    else clearError();
    scheduleLinkPreview(p);
  },
});

registerChanges({
  'pick-file': async el => {
    const p = live();
    const file = /** @type {File|undefined} */ (el.files?.[0]);
    if (!p || !file || p.busy) return;
    p.busy = true;
    p.uploadError = '';
    p.uploadNote = '';
    refreshPanel(p);
    try {
      const {dataURL, width, height, bytes} = await shrinkImage(file);
      const ref = await saveImageDataUrl(dataURL);
      if (live() !== p) {
        deleteMedia(ref.slice(6)).catch(() => {});
        return;
      }
      p.uploads.push(ref);
      p.image = ref;
      p.restore = ref;
      p.url = '';
      p.linkState = 'idle';
      p.uploadNote = `${width}×${height}px · ${Math.max(1, Math.round(bytes / 1024))} KB · tap “Use this” to keep it.`;
    } catch (err) {
      p.uploadError = messageOf(err);
    } finally {
      p.busy = false;
      if (live() === p) {
        // The person may have switched tabs while the photo was shrinking: refresh whichever panel is showing (its
        // pressed tiles / photo notice depend on the image) unless they are typing in it right now.
        const typing = document.activeElement instanceof HTMLInputElement && q('#pick-panel')?.contains(document.activeElement);
        if (p.tab === 'upload' || !typing) refreshPanel(p);
        refreshPreview(p);
        if (p.tab === 'upload') q('#pick-file')?.focus();
      }
    }
  },
});

/** @param {unknown} err */
const messageOf = err => (err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : '')
  || 'That photo didn’t work. Try a JPG or PNG.';

// Arrow keys / Home / End move between tabs (roving tabindex).
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => {
    const tab = /** @type {HTMLElement} */ (e.target)?.closest?.('.pick-tab');
    const p = tab && live();
    if (!p || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = tabOrder.indexOf(p.tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % tabOrder.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabOrder.length) % tabOrder.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? tabOrder.length - 1
            : -1;
    if (next < 0) return;
    e.preventDefault();
    switchTab(p, tabOrder[next], true);
  });
  // Back online: retry a link preview that failed (the error copy promised it would load).
  window.addEventListener('online', () => {
    const p = live();
    if (!p || p.linkState !== 'error' || !isLink(p.image)) return;
    p.linkState = 'loading';
    refreshPreview(p);
    if (p.tab !== 'link') return;
    const el = q('#pick-link-preview');
    if (!el) return;
    el.dataset.state = linkStateOf(p);
    el.innerHTML = linkPreviewHtml(p);
    wireLinkImage(p);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Upload processing: decode → downscale to ≤320px → WebP (JPEG fallback) → ≤150 KB
// ---------------------------------------------------------------------------------------------------------------------

/** @param {File} file */
function unsupportedReason(file) {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (/heic|heif/.test(type) || /\.(heic|heif)$/.test(name)) {
    return 'iPhone HEIC photos can’t be read here. Take a screenshot of the photo (or set Camera › Formats › Most Compatible) and upload that.';
  }
  if (type && !type.startsWith('image/')) return 'That file isn’t a picture. Pick a JPG, PNG or WebP photo.';
  if (/svg/.test(type) || /\.svg$/.test(name)) return 'SVG files aren’t supported here. Pick a JPG, PNG or WebP photo.';
  if (file.size === 0) return 'That file is empty. Pick another photo.';
  if (file.size > UPLOAD_MAX_INPUT) return `That file is huge (${Math.round(file.size / 1048576)} MB). Pick a photo under ${UPLOAD_MAX_INPUT / 1048576} MB.`;
  return '';
}

/**
 * Decode a picked file into something drawable.
 * @param {File} file
 * @returns {Promise<{source: CanvasImageSource, width: number, height: number, close: () => void}>}
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return {source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.()};
    } catch {
      // fall through to <img> decoding (older Safari, odd formats)
    }
  }
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(Error('Couldn’t read that file. Try picking it again.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(Error('Couldn’t open that photo. Try a JPG or PNG (iPhone HEIC photos need a screenshot first).'));
    el.src = /** @type {string} */ (src);
  });
  return {source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {}};
}

/** Decoded bytes of a base64 data URL. @param {string} dataURL */
function dataUrlBytes(dataURL) {
  const b64 = dataURL.slice(dataURL.indexOf(',') + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Shrink a picked image for storage: ≤320px longest side, WebP when the browser can encode it (else JPEG),
 * quality lowered step by step until it fits in 150 KB.
 * @param {File} file
 * @returns {Promise<{dataURL: string, width: number, height: number, bytes: number, type: string}>}
 */
export async function shrinkImage(file) {
  const reason = unsupportedReason(file);
  if (reason) throw Error(reason);
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) throw Error('That photo looks empty. Try another one.');
    let scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(decoded.width, decoded.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('This browser can’t resize photos. Try Chrome.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decoded.source, 0, 0, width, height);
      let type = 'image/webp';
      let first = canvas.toDataURL(type, QUALITIES[0]);
      if (!first.startsWith('data:image/webp')) {
        // No WebP encoder (older Safari): JPEG has no transparency, so put the photo on a white card first.
        type = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        first = canvas.toDataURL(type, QUALITIES[0]);
      }
      if (!first.startsWith(`data:${type};base64,`)) throw Error('This browser couldn’t save the photo. Try Chrome.');
      for (const quality of QUALITIES) {
        const dataURL = quality === QUALITIES[0] ? first : canvas.toDataURL(type, quality);
        const bytes = dataUrlBytes(dataURL);
        if (bytes <= UPLOAD_MAX_BYTES) return {dataURL, width, height, bytes, type};
      }
      scale *= 0.75;
    }
    throw Error('That photo is too detailed to shrink. Try a simpler or smaller one.');
  } finally {
    decoded.close();
  }
}
