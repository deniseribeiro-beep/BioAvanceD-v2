const fs = require('fs');
const path = require('path');

/**
 * Converts an official HPO OBO Graphs JSON release (hp.json) into the
 * RF028 sample JSONL shape expected by normalizeHpo:
 *   { id, lbl, is_a[], synonyms[], obsolete }
 *
 * Lab-only — never imported by sources/hpo.js or the default pipeline path.
 */

function toCurie(iri) {
  if (typeof iri !== 'string' || !iri) return '';
  // Bare CURIEs only — do not treat http(s)://… as a CURIE prefix.
  if (/^[A-Za-z][A-Za-z0-9]*:[^\s/]+$/.test(iri) && !/^[A-Za-z][A-Za-z0-9]*:\/\//.test(iri)) {
    return iri;
  }
  const m = iri.match(/\/([A-Za-z0-9]+)_(.+)$/);
  if (m) return `${m[1]}:${m[2]}`;
  return '';
}

function convertHpoJsonToJsonlRecords(oboGraphsJson) {
  const graph = Array.isArray(oboGraphsJson.graphs) ? oboGraphsJson.graphs[0] : null;
  if (!graph || !Array.isArray(graph.nodes)) {
    throw new Error('HPO JSON sem graphs[0].nodes — esperado formato OBO Graphs (hp.json).');
  }

  const parentsBySub = new Map();
  for (const edge of graph.edges || []) {
    if (!edge || edge.pred !== 'is_a') continue;
    const sub = toCurie(edge.sub);
    const obj = toCurie(edge.obj);
    if (!sub || !obj) continue;
    if (!parentsBySub.has(sub)) parentsBySub.set(sub, []);
    parentsBySub.get(sub).push(obj);
  }

  const records = [];
  for (const node of graph.nodes) {
    if (!node || node.type !== 'CLASS') continue;
    const id = toCurie(node.id);
    if (!id.startsWith('HP:')) continue;
    const lbl = typeof node.lbl === 'string' ? node.lbl : '';
    const synonyms = Array.isArray(node.meta && node.meta.synonyms)
      ? node.meta.synonyms
        .map((s) => (s && typeof s.val === 'string' ? s.val.trim() : ''))
        .filter(Boolean)
      : [];
    const obsolete = Boolean(node.meta && node.meta.deprecated);
    records.push({
      id,
      lbl,
      is_a: parentsBySub.get(id) || [],
      synonyms,
      obsolete,
    });
  }
  return records;
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'w');
  try {
    for (const record of records) {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {{ inputPath: string, outputPath: string }} opts
 * @returns {{ recordCount: number, outputPath: string }}
 */
function convertHpoFile({ inputPath, outputPath }) {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const records = convertHpoJsonToJsonlRecords(raw);
  writeJsonl(outputPath, records);
  return { recordCount: records.length, outputPath };
}

async function main(argv = process.argv.slice(2)) {
  let inputPath = null;
  let outputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') inputPath = argv[++i];
    else if (argv[i] === '--out') outputPath = argv[++i];
  }
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: convertHpoToJsonl.js --in <hp.json> --out <data.jsonl>\n');
    process.exit(2);
  }
  const result = convertHpoFile({ inputPath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  toCurie,
  convertHpoJsonToJsonlRecords,
  convertHpoFile,
};
