// @ts-check
// Shared, dependency-free helpers. Pure functions only (no DOM access).

/** @returns {string} RFC 4122 v4 UUID (also used as idempotency key). */
export const uuid = () => globalThis.crypto.randomUUID();

/**
 * Format integer paise as Indian rupees. Whole rupees drop the decimals.
 * @param {number} p paise (may be negative)
 * @returns {string} e.g. "₹1,234" or "₹12.50"
 */
export const money = p =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: p % 100 ? 2 : 0,
    maximumFractionDigits: p % 100 ? 2 : 0,
  }).format(p / 100);

/**
 * Parse a rupee amount typed by a person into exact integer paise.
 * Accepts "30", "30.5", "30.50". Rejects negatives, >2 decimals, junk, > ₹10,00,000.
 * @param {string|number} v
 * @returns {number} paise
 */
export const paise = v => {
  const s = String(v ?? '').trim().replace(/^₹\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw Error('Enter a positive amount with at most 2 decimal places.');
  const [a, b = ''] = s.split('.');
  const n = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > 100000000) throw Error('Amount is too large.');
  return n;
};

/**
 * Assert a safe integer >= min.
 * @param {unknown} n
 * @param {number} [min]
 * @returns {number}
 */
export function integer(n, min = 0) {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min) throw Error('Invalid whole number.');
  return n;
}

/** HTML-escape any value for safe interpolation into markup. @param {unknown} x */
export const esc = x =>
  String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

export const IST = 'Asia/Kolkata';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: '2-digit', hour12: false });

/**
 * Calendar day in India (Asia/Kolkata) for a timestamp.
 * @param {string|number|Date} [at]
 * @returns {string} "YYYY-MM-DD"
 */
export function istDate(at = new Date()) {
  return dayFormatter.format(new Date(at));
}

/**
 * Two-digit hour (00–23) in India for a timestamp.
 * @param {string|number|Date} at
 * @returns {string}
 */
export function istHour(at) {
  const h = hourFormatter.format(new Date(at));
  return h === '24' ? '00' : h.padStart(2, '0');
}

/**
 * Up to two uppercase initials from a name ("Team Pataka" → "TP", "viraj" → "V").
 * @param {string} name
 * @returns {string}
 */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'MY';
  return words.slice(0, 2).map(w => [...w][0]).join('').toUpperCase();
}

/**
 * URL/file-safe slug ("Chai & Maggi!" → "chai-maggi").
 * @param {string} text
 * @param {number} [max]
 */
export function slug(text, max = 40) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'stall';
}

/** @param {number} n @param {number} a @param {number} b */
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Pad a token number for display: 7 → "#07", 123 → "#123". @param {number|null|undefined} n */
export const tokenLabel = n => (n == null ? '' : `#${String(n).padStart(2, '0')}`);

const stampFormatter = new Intl.DateTimeFormat('en-CA', {timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
/**
 * Sortable India-time stamp for exports: "2026-11-04 18:05".
 * @param {string|number|Date} at
 * @returns {string}
 */
export function istStamp(at) {
  const parts = Object.fromEntries(stampFormatter.formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}
