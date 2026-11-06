// @ts-check
// "Classic" illustrations carried over from the original Packet Pataka stall app.
// Kept with their original ids so menus migrated from v1 keep the same look.
// Each entry's `svg` is inner markup for a 150×150 viewBox (library.mjs adds the wrapper).

const sparks = '<g stroke="#171717" stroke-width="2" fill="#ffdd35"><path d="m30 32-9-9 5-4 8 11Z"/><path d="m43 24-3-15 6-1 1 16Z"/><path d="m111 35 9-11 5 5-12 9Z"/></g>';
const garnish = '<path d="m53 56 8 4m15-10 7 4m-20 19 8-4m13-2 7 3" stroke="#42934b" stroke-width="4" stroke-linecap="round"/><g fill="#eb4235"><circle cx="60" cy="61" r="3"/><circle cx="82" cy="60" r="3"/><circle cx="71" cy="47" r="3"/><circle cx="91" cy="55" r="3"/></g>';

/** @param {'packet'|'corn'} type */
function packet(type) {
  let inner = '<path d="m36 61 19 67 46-5 14-65-79 3Z" fill="#ffdc31" stroke="#171717" stroke-width="3"/><path d="m36 61 54 44 25-47-79 3Z" fill="#ff528d" stroke="#171717" stroke-width="2"/><path d="m55 128 35-23 11 18-46 5Z" fill="#ff528d" stroke="#171717" stroke-width="2"/><path d="m41 68 14 50m50-47-8 39" stroke="#fff8cf" stroke-width="3"/>';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      const cx = 44 + x * 11 + (y % 2) * 4;
      const cy = 40 + y * 9 + Math.abs(x - 2.5) * 3;
      inner += `<ellipse cx="${cx}" cy="${cy}" rx="8" ry="6" transform="rotate(${x * 23} ${cx} ${cy})" fill="${type === 'corn' ? '#ffd229' : x % 2 ? '#f6a222' : '#ffce42'}" stroke="#a96618" stroke-width="1.3"/>`;
    }
  }
  if (type !== 'corn') inner += '<path d="m42 56 14-7 9 13 13-18 8 19 17-10" fill="none" stroke="#fffae7" stroke-width="5" stroke-linecap="round"/>' + garnish;
  inner += '<path d="m63 93 8-8-2 9 12 1-12 10 3-11-9-1Z" fill="#fff9ed" stroke="#171717" stroke-width="1.5"/>';
  return sparks + inner;
}

function pizzaBites() {
  let inner = '';
  for (const [x, y] of [[52, 75], [91, 71], [72, 101]]) {
    inner += `<path d="m${x - 22} ${y - 8} 5 29q17 13 34-1l5-29" fill="#d67f26" stroke="#492d18" stroke-width="2"/><ellipse cx="${x}" cy="${y - 9}" rx="23" ry="16" fill="#ffc557" stroke="#492d18" stroke-width="2"/><path d="m${x - 17} ${y - 8} 8-8 8 12 7-12 10 9" stroke="#fff9d7" stroke-width="5" fill="none"/><g fill="#e6492f"><circle cx="${x - 6}" cy="${y - 15}" r="4"/><circle cx="${x + 13}" cy="${y - 6}" r="4"/></g><path d="m${x - 12} ${y} 6-4m7-6 6-3" stroke="#3c8d41" stroke-width="3"/>`;
  }
  return sparks + inner;
}

/** @param {'lemon'|'masala'|'cold'} type */
function glass(type) {
  const color = type === 'masala' ? '#f9a24d' : type === 'cold' ? '#9b633e' : '#d8e46f';
  let inner = `<path d="m90 23-13 76" stroke="#171717" stroke-width="7"/><path d="m90 23-13 76" stroke="#ff528d" stroke-width="4"/><path d="m40 48 9 78q25 10 50 0l9-78" fill="${color}" stroke="#171717" stroke-width="3"/><ellipse cx="74" cy="48" rx="34" ry="10" fill="#f5ffc6" stroke="#171717" stroke-width="3"/><path d="m47 63 6 53" stroke="#fffbed" stroke-width="4" opacity=".8"/>`;
  if (type !== 'cold') {
    inner += '<g fill="#fcffc2" stroke="#a8b64f" stroke-width="2"><circle cx="78" cy="84" r="15"/><circle cx="79" cy="117" r="12"/></g><path d="m78 69v30m-15-15h30m-25-10 20 20m0-20-20 20" stroke="#b5c35b" stroke-width="2"/><path d="M72 43Q43 15 60 13q18 1 12 30Zm1 0q2-33 22-28 4 17-22 28Z" fill="#53934c" stroke="#285f32" stroke-width="2"/><path d="m64 22 8 21 15-20" stroke="#bbd875" stroke-width="2"/>';
  } else {
    inner += '<path d="m46 74 57-5-4 34-49 5Z" fill="#ff528d" stroke="#171717" stroke-width="2"/><text x="58" y="94" font-size="18" font-weight="900" fill="#fff9ed">POP!</text>';
  }
  return sparks + inner;
}

/** @type {Record<string, {label: string, group: string, keywords: string[], svg: string}>} */
export default {
  packet: { label: 'Chips Packet (classic)', group: 'classic', keywords: ['chips', 'packet', 'chaat', 'crispy', 'namkeen'], svg: packet('packet') },
  corn: { label: 'Corn Chips Packet (classic)', group: 'classic', keywords: ['corn', 'chips', 'packet', 'cheese'], svg: packet('corn') },
  pizza: { label: 'Pizza Bites (classic)', group: 'classic', keywords: ['pizza', 'bites', 'cheese'], svg: pizzaBites() },
  lemon: { label: 'Lemon Soda Glass (classic)', group: 'classic', keywords: ['lemon', 'soda', 'nimbu', 'drink', 'sprite'], svg: glass('lemon') },
  masala: { label: 'Orange Soda Glass (classic)', group: 'classic', keywords: ['orange', 'masala', 'soda', 'drink', 'fanta'], svg: glass('masala') },
  cold: { label: 'Cola Glass (classic)', group: 'classic', keywords: ['cola', 'cold drink', 'soda', 'coke'], svg: glass('cold') },
};
