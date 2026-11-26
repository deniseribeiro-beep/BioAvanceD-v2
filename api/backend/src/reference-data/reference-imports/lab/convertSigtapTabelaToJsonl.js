#!/usr/bin/env node
/**
 * Lab converter: SIGTAP TabelaUnificada tb_procedimento.txt (fixed-width) → JSONL
 * { id, lbl, is_a[], synonyms[], obsolete }
 * Layout: CO_PROCEDIMENTO 1-10, NO_PROCEDIMENTO 11-260 (tb_procedimento_layout.txt).
 * No network. Usage:
 *   node convertSigtapTabelaToJsonl.js --in .../tb_procedimento.txt --out .../sigtap.jsonl [--limit N]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = { inPath: null, outPath: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.inPath = argv[++i];
    if (argv[i] === '--out') args.outPath = argv[++i];
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function parseSigtapLine(line) {
  if (!line || line.length < 10) return null;
  const code = line.slice(0, 10).trim();
  const display = line.slice(10, Math.min(260, line.length)).trim();
  if (!/^\d{10}$/.test(code) || !display) return null;
  return {
    id: code,
    lbl: display,
    is_a: [],
    synonyms: [],
    obsolete: false,
  };
}

async function convertFile(inPath, outPath, limit) {
  const rl = readline.createInterface({
    input: fs.createReadStream(inPath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  let written = 0;
  for await (const line of rl) {
    const rec = parseSigtapLine(line);
    if (!rec) continue;
    out.write(`${JSON.stringify(rec)}\n`);
    written += 1;
    if (limit && written >= limit) break;
  }
  await new Promise((resolve, reject) => {
    out.end(() => resolve());
    out.on('error', reject);
  });
  return written;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.inPath || !args.outPath) {
    process.stderr.write('Usage: convertSigtapTabelaToJsonl.js --in <tb_procedimento.txt> --out <jsonl> [--limit N]\n');
    process.exit(2);
  }
  const written = await convertFile(path.resolve(args.inPath), path.resolve(args.outPath), args.limit);
  process.stdout.write(`${JSON.stringify({ records: written, outPath: args.outPath })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { parseSigtapLine, convertFile };
