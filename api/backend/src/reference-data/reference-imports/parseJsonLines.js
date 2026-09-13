const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

/**
 * RF028 AC 4/7.2 step 5 ("Parse"): reads the source artifact line-by-line via
 * a readline stream, never loading the full file into memory — the same
 * requirement a real OBO/OWL/TSV parser would have to satisfy for a
 * multi-gigabyte release.
 */
async function* streamJsonLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rowNumber = 0;
  for await (const line of rl) {
    rowNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield { rowNumber, line: trimmed };
  }
}

/** RF028 AC 3/7.2 step 3 ("Integrity"): SHA-256 over the raw artifact bytes. */
async function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let fileSize = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      fileSize += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', () => resolve({ checksum: hash.digest('hex'), fileSize }));
    stream.on('error', reject);
  });
}

module.exports = { streamJsonLines, checksumFile };
