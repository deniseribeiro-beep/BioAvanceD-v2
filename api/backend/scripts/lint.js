const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK_DIRS = ['src', 'scripts'];
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function collectFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const stack = [abs];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist') continue;
        stack.push(full);
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  }

  return files;
}

function checkSyntax(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const files = CHECK_DIRS.flatMap(collectFiles);
for (const file of files) {
  checkSyntax(file);
}

console.log(`[lint] checked ${files.length} backend files`);
