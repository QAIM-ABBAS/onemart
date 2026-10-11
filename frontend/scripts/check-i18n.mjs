import fs from 'node:fs';
import path from 'node:path';
const root = 'src/i18n/locales';
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`],
  );
let bad = false;
const langs = fs.readdirSync(root);
const nsList = new Set(langs.flatMap((l) => fs.readdirSync(path.join(root, l))));
for (const ns of nsList) {
  const sets = langs.map((l) => {
    const f = path.join(root, l, ns);
    return new Set(fs.existsSync(f) ? flat(JSON.parse(fs.readFileSync(f, 'utf8'))) : []);
  });
  const all = new Set(sets.flatMap((s) => [...s]));
  langs.forEach((l, i) => {
    for (const k of all) if (!sets[i].has(k)) { console.log(`MISSING [${l}] ${ns}: ${k}`); bad = true; }
  });
}
if (bad) process.exit(1);
console.log('i18n OK: all languages have the same keys');
