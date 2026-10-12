import fs from 'node:fs';
import path from 'node:path';

const LOC = 'src/i18n/locales/en';
const dict = {};
for (const f of fs.readdirSync(LOC)) {
  dict[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(LOC, f), 'utf8'));
}
const has = (ns, key) => {
  let o = dict[ns];
  if (!o) return false;
  for (const p of key.split('.')) {
    if (o && typeof o === 'object' && p in o) o = o[p];
    else return false;
  }
  return true;
};
const hasP = (ns, key) =>
  has(ns, key) || has(ns, key + '_one') || has(ns, key + '_other') || has(ns, key + '_zero');

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'locales' ? [] : walk(path.join(d, e.name));
    return /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(d, e.name)] : [];
  });

let bad = 0;
for (const f of walk('src')) {
  const s = fs.readFileSync(f, 'utf8');
  const m = s.match(/useTranslation\(\s*\[?\s*['"]([^'"]+)['"]/);
  const defNs = m ? m[1] : 'common';
  for (const t of s.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    let key = t[1];
    let ns = defNs;
    if (key.includes(':')) [ns, key] = key.split(':');
    if (!hasP(ns, key)) {
      console.log(`${f}: missing "${ns}:${key}"`);
      bad++;
    }
  }
}
console.log(bad ? `${bad} missing key(s)` : 'all used keys exist');
process.exit(bad ? 1 : 0);