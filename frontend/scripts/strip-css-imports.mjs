import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const root = path.resolve('src');
let n = 0;
for (const file of walk(root)) {
  const s = fs.readFileSync(file, 'utf8');
  const next = s.replace(/^import\s+['"][^'"]+\.css['"];\r?\n/gm, (m) => {
    if (m.includes('App.css') || m.includes('.module.css') || m.includes('index.css')) return m;
    return '';
  });
  if (next !== s) {
    fs.writeFileSync(file, next);
    n += 1;
    console.log(path.relative(root, file));
  }
}
console.log('UPDATED', n);
