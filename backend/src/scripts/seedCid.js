require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');

const CSV_PATH = path.resolve(__dirname, '../../../data/cid10_completo.csv');

function cleanValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/""/g, '"')
    .trim();
}

function normalizePossiblyCollapsedRow(rawRow) {
  const row = {
    Capitulo: cleanValue(rawRow.Capitulo),
    Codigo_Tabulacao: cleanValue(rawRow.Codigo_Tabulacao),
    Descricao: cleanValue(rawRow.Descricao),
    Codigos_CID10: cleanValue(rawRow.Codigos_CID10)
  };

  if (row.Codigo_Tabulacao && row.Descricao && row.Codigos_CID10) {
    return row;
  }

  const flattened = [rawRow.Capitulo, rawRow.Codigo_Tabulacao, rawRow.Descricao, rawRow.Codigos_CID10]
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => cleanValue(part))
    .join(',');

  const match = flattened.match(/^([IVXLCDM]+),([^,]+),(.+),([A-Z0-9][A-Z0-9.,\-\s]+)$/i);
  if (!match) {
    return row;
  }

  return {
    Capitulo: cleanValue(match[1]),
    Codigo_Tabulacao: cleanValue(match[2]),
    Descricao: cleanValue(match[3]),
    Codigos_CID10: cleanValue(match[4])
  };
}

function readCidCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath, { encoding: 'utf8' })
      .pipe(csv())
      .on('data', (rawRow) => {
        const row = normalizePossiblyCollapsedRow(rawRow);
        if (!row.Codigo_Tabulacao) return;

        rows.push({
          Capitulo: row.Capitulo || null,
          Codigo_Tabulacao: row.Codigo_Tabulacao,
          Descricao: row.Descricao || null,
          Codigos_CID10: row.Codigos_CID10 || null
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function buildBulkOps(rows) {
  return rows.map((row) => ({
    updateOne: {
      filter: { Codigo_Tabulacao: row.Codigo_Tabulacao },
      update: {
        $set: {
          Capitulo: row.Capitulo,
          Codigo_Tabulacao: row.Codigo_Tabulacao,
          Descricao: row.Descricao,
          Codigos_CID10: row.Codigos_CID10,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      upsert: true
    }
  }));
}

async function run() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Arquivo CSV não encontrado em: ${CSV_PATH}`);
  }

  const db = await connectDB();
  const cidsCollection = await getCollection(db, 'cids');

  const rows = await readCidCsv(CSV_PATH);
  if (rows.length === 0) {
    console.log('Nenhum registro válido encontrado no CSV.');
    return;
  }

  const ops = buildBulkOps(rows);
  const chunkSize = 1000;

  let totalMatched = 0;
  let totalModified = 0;
  let totalUpserted = 0;

  for (let index = 0; index < ops.length; index += chunkSize) {
    const chunk = ops.slice(index, index + chunkSize);
    const result = await cidsCollection.bulkWrite(chunk, { ordered: false });
    totalMatched += result.matchedCount || 0;
    totalModified += result.modifiedCount || 0;
    totalUpserted += result.upsertedCount || 0;
  }

  await cidsCollection.createIndex({ Codigo_Tabulacao: 1 }, { unique: true, name: 'codigo_tabulacao_unique' });
  await cidsCollection.createIndex({ Descricao: 'text', Codigos_CID10: 'text' }, { name: 'cid_text_search' });

  console.log('✅ Seed de CID concluído');
  console.log(`📄 Linhas lidas: ${rows.length}`);
  console.log(`🔁 Registros existentes encontrados: ${totalMatched}`);
  console.log(`✏️ Registros atualizados: ${totalModified}`);
  console.log(`🆕 Registros inseridos (upsert): ${totalUpserted}`);
}

run()
  .catch((error) => {
    console.error('❌ Erro ao executar seed de CID:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeConnection();
    } catch (_) {}
  });
