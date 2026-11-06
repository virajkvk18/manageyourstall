// Static checks for the no-build dist/ app. Run with `npm run check`.
// 1. Every .mjs/.js file parses (node --check).
// 2. Every relative import resolves to a real file.
// 3. The service worker precaches every shipped asset, and nothing that is missing.
// 4. index.html only references files that exist.
// 5. No legacy "Packet Pataka" platform branding in the shell, UI modules or CSS.
import {readdirSync, readFileSync, statSync, existsSync} from 'node:fs';
import {join, relative, dirname, resolve, sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = resolve('dist');
const problems = [];
const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root);
const rel = p => relative(root, p).split(sep).join('/');

for (const file of files.filter(f => /\.(mjs|js)$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  if (r.status !== 0) problems.push(`Syntax error in ${rel(file)}:\n${r.stderr.trim()}`);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/g)) {
    const spec = m[1] || m[2] || m[3];
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) problems.push(`${rel(file)} imports missing file ${spec}`);
  }
}

const swPath = join(root, 'sw.js');
if (!existsSync(swPath)) problems.push('dist/sw.js is missing');
else {
  const sw = readFileSync(swPath, 'utf8');
  const list = sw.match(/ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!list) problems.push('sw.js must declare `const ASSETS=[...]`');
  else {
    const assets = new Set([...list[1].matchAll(/['"]\.\/([^'"]*)['"]/g)].map(m => m[1]).filter(Boolean));
    for (const a of assets) if (!existsSync(join(root, a))) problems.push(`sw.js precaches missing file ./${a}`);
    for (const f of files.map(rel)) {
      if (f === 'sw.js' || f.endsWith('.map')) continue;
      if (!assets.has(f)) problems.push(`sw.js does not precache ./${f}`);
    }
  }
}

const indexPath = join(root, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)) if (!existsSync(join(root, m[1]))) problems.push(`index.html references missing ./${m[1]}`);
}

const brandScoped = files.filter(f => /(^|[\\/])(index\.html|manifest\.webmanifest)$/.test(f) || /[\\/](ui|css)[\\/]/.test(f));
for (const f of brandScoped) if (/packet\s*pataka/i.test(readFileSync(f, 'utf8'))) problems.push(`${rel(f)} still contains "Packet Pataka" branding`);

if (problems.length) {
  console.error(`✖ ${problems.length} problem(s):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`✔ dist/ checks passed (${files.length} files)`);
