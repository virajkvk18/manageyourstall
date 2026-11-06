// UI line icons for ManageYourStall: 24×24 viewBox, stroke-only paths, 1.9 stroke, round caps/joins.
// Food illustrations live in library.mjs; these are interface icons only (no brand logos).

/** Icon name → SVG path data. */
export const icons = Object.freeze({
  // navigation & screens
  sell: 'M3 9h18l-2-6H5L3 9Zm1 0v12h16V9M9 21v-8h6v8M3 9c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0',
  dashboard: 'M4 21V11h4v10M10 21V3h4v18M16 21v-7h4v7',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3',
  milestones: 'm3 6 4 4 5-7 5 7 4-4-3 13H6L3 6Zm3 16h12',
  more: 'M5 12h.01M12 12h.01M19 12h.01M5 12a1 1 0 1 0 0 .01M12 12a1 1 0 1 0 0 .01M19 12a1 1 0 1 0 0 .01',
  menu: 'M4 4h11a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3V4Zm0 14a3 3 0 0 1 3-3h11M8 8h6',
  studio: 'M4 20 15 9m-2-2 4 4M18 3v4m-2-2h4M20 13v3m-1.5-1.5h3M9 3v3M7.5 4.5h3',
  queue: 'M7 4h10M5 8h14v12H5V8Zm4 4h6m-6 4h4',
  chef: 'M7 14v6h10v-6M7 14a4 4 0 0 1-.8-7.9A5 5 0 0 1 12 3a5 5 0 0 1 5.8 3.1A4 4 0 0 1 17 14H7Zm0 3h10',
  note: 'M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8M8 16h6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',

  // basic actions
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L20 5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m-6-6 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  cart: 'M2 3h3l3 12h11l3-9H6M9 20h.01M18 20h.01M9 20a1 1 0 1 0 0 .01M18 20a1 1 0 1 0 0 .01',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-7l1-7',
  game: 'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 0v10m-9-5 9 5 9-5m-9 5v10M7 10h.01M17 14h.01',
  target: 'M21 12a9 9 0 1 1-9-9M16 12a4 4 0 1 1-4-4m0 4 9-9m-5 0h5v5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3c0-.4 0-.8-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  sliders: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
  lock: 'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2',
  unlock: 'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 5.8-1.1M12 15v2',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16m0 5v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8m0-5v5h-5',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
  copy: 'M9 9h11v11H9V9ZM5 15H4V4h11v1',
  duplicate: 'M8 8h12v12H8V8Zm6 3v6m-3-3h6M4 16V4h12',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off':
    'M3 3l18 18M10.6 5.1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',

  // money & payments
  cash: 'M2 6h20v13H2V6Zm10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6M5 12h.01M19 12h.01',
  upi: 'M6 2h12v20H6V2Zm4 3h4M10 18h4M9.5 13.5l2-5 1 3 2-3',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v2h-2v-2Z',
  split: 'M12 21v-7m0 0c0-3-6-4-6-9V3m6 11c0-3 6-4 6-9V3M3 6l3-3 3 3m6 0 3-3 3 3',
  wallet: 'M3 6v13h18V9H3m0-3a2 2 0 0 1 2-2h11v5m0 6h.01',
  receipt: 'M5 3h14v18l-2.3-1.5-2.4 1.5-2.3-1.5-2.3 1.5-2.4-1.5L5 21V3Zm4 5h6m-6 4h6m-6 4h3',
  rupee: 'M6 4h12M6 9h12M9 4c6 0 6 10 0 10H6l9 7',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  gift: 'M3 8h18v4H3V8Zm2 4v9h14v-9M12 8v13m0-13S11 3 8 3a2.5 2.5 0 0 0 0 5m4 0s1-5 4-5a2.5 2.5 0 0 1 0 5',
  ticket: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Zm11 0v2m0 3v2m0 3v-1',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4.5 4.5h.01',

  // stall & people
  store: 'M4 10v10h16V10M2 7l2-4h16l2 4v1a3 3 0 0 1-6 0 3 3 0 0 1-4 0 3 3 0 0 1-4 0 3 3 0 0 1-6 0V7Zm8 13v-5h4v5',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0L12 12l9-4.5M12 12v9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3',
  phone: 'M7 2h10v20H7V2Zm4 16h2',
  calendar: 'M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chat: 'M4 5h16v11H9l-5 4V5Zm4 5.5h.01M12 10.5h.01M16 10.5h.01',

  // fun & status
  spark: 'm12 2 2 7 8 3-8 3-2 7-3-7-7-3 7-3 3-7',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  fire: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8a7 7 0 0 0 7 7Zm0 0a3 3 0 0 1-3-3c0-2 3-4 3-4s3 2 3 4a3 3 0 0 1-3 3Z',
  trophy: 'M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H3v1a4 4 0 0 0 4 4m10-5h4v1a4 4 0 0 1-4 4',
  palette:
    'M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.8C21 6 17 3 12 3ZM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  image: 'M3 5h18v14H3V5Zm0 11 5-5 4 4 3-3 6 6M15.5 9.5h.01',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  'wifi-off': 'M3 3l18 18M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M5 12.5a10 10 0 0 1 4-2.3M2 9a15 15 0 0 1 4.5-3M17.5 6A15 15 0 0 1 22 9m-7 1.2a10 10 0 0 1 4 2.3',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.5-13a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01',
});

/** Names of every available icon. */
export const ICON_NAMES = Object.freeze(Object.keys(icons));

/**
 * Inline SVG for a UI icon (decorative: aria-hidden). Unknown names render 'spark'.
 * @param {string} name
 * @param {string} [cls] extra classes for the <svg>
 * @returns {string}
 */
export const icon = (name, cls = '') =>
  `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${icons[name] || icons.spark}"/></svg>`;
