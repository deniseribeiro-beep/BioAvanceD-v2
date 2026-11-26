// The stock v8 coverage provider remaps every script against Vite's transform
// of its file. A file the tests load through Node's own `require` was measured
// by V8 as the file on disk, so its offsets land on the wrong code of the
// reprinted transform (#1337). This module wraps the private `remapCoverage`
// of @vitest/coverage-v8 4.1.10 to remap such a script against the file on
// disk instead. See docs/decisions/2026-10-30-backend-coverage-native-require.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import v8mod from '@vitest/coverage-v8';

function readOnDisk(url) {
  try {
    return fs.readFileSync(fileURLToPath(url), 'utf8');
  } catch {
    return null;
  }
}

// A script Node evaluated as the file on disk: no module-runner wrapper, and
// its widest root range ends exactly at the file's length.
function measuredAsOnDisk(wrapperLength, functions, original) {
  if (wrapperLength !== 0 || functions.length === 0 || original == null) return false;
  if (!functions.some((f) => f.ranges[0].startOffset === 0)) return false;
  return Math.max(...functions.map((f) => f.ranges[0].endOffset)) === original.length;
}

export default {
  ...v8mod,
  async getProvider() {
    const provider = await v8mod.getProvider();
    if (typeof provider.remapCoverage !== 'function') {
      throw new Error(
        `@vitest/coverage-v8 ${provider.version ?? '(unknown version)'} has no remapCoverage method; `
          + 'tests/support/coverage-native-require.mjs was written for 4.1.10 and must be updated.',
      );
    }
    const remap = provider.remapCoverage.bind(provider);
    provider.remapCoverage = async (url, wrapperLength, result, functions) => {
      const original = wrapperLength === 0 && functions.length > 0 ? readOnDisk(url) : null;
      if (measuredAsOnDisk(wrapperLength, functions, original)) {
        return remap(url, 0, { code: original }, functions);
      }
      return remap(url, wrapperLength, result, functions);
    };
    return provider;
  },
};
