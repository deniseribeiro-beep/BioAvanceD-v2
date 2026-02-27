const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'frontend', 'src');
const missing = new Set();

function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!entry.isFile() || !fullPath.endsWith('.tsx')) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const regex = /import\s+['"](\.\/[^'"]+\.css)['"]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const cssPath = path.resolve(path.dirname(fullPath), match[1]);
      if (!fs.existsSync(cssPath)) {
        missing.add(cssPath);
      }
    }
  }
}

walk(root);

const list = Array.from(missing).sort();
for (const filePath of list) {
  console.log(filePath);
}
console.log(`TOTAL_MISSING=${list.length}`);
