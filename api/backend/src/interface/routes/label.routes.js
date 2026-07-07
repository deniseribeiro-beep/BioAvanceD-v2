const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const { getCollection } = require('../../utils/collectionResolver');
const qualityDomain = require('../../services/quality-domain.service');

const router = express.Router();

function normalizeString(value) {
  return String(value || '').trim();
}

function escapeXml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeZpl(value) {
  return normalizeString(value).replace(/[\^~]/g, '');
}

async function findSample(db, sampleId) {
  const samplesCollection = await getCollection(db, 'samples');
  const search = normalizeString(sampleId).replace(/^BIOAVANCED:SAMPLE:/i, '');
  const queries = [];

  if (ObjectId.isValid(search)) {
    queries.push({ _id: new ObjectId(search) });
  }

  queries.push(
    { sampleID: search },
    { sampleId: search },
    { barcode: search },
    { 'barcodeSymbologies.code128': search },
    { 'barcodeIndustrial.payload': search }
  );

  return samplesCollection.findOne({ $or: queries });
}

async function resolveStoragePathText(db, sample) {
  const storageLocation = sample?.storageLocation || {};
  const hasBoxLocation = Boolean(storageLocation.boxId || storageLocation.boxID);
  const hasPosition = Boolean(storageLocation.position);

  if (!hasBoxLocation || !hasPosition) {
    return null;
  }

  const storagePathsCollection = await getCollection(db, 'storagePaths');
  const boxId = storageLocation.boxId || storageLocation.boxID;
  const boxVariants = ObjectId.isValid(String(boxId)) ? [new ObjectId(String(boxId)), String(boxId)] : [String(boxId)];
  const storagePath = await storagePathsCollection.findOne({
    boxId: { $in: boxVariants },
  });

  return storagePath?.path || storageLocation.readable || null;
}

function buildLocationText(sample, storagePathText) {
  const storageLocation = sample?.storageLocation || {};
  const parts = [
    storagePathText ? `Localização ${storagePathText}` : null,
    sample?.locationID ? `Loc ${sample.locationID}` : null,
    storageLocation.boxName || storageLocation.boxID || storageLocation.boxId ? `Box ${storageLocation.boxName || storageLocation.boxID || storageLocation.boxId}` : null,
    storageLocation.position ? `Pos ${storageLocation.position}` : null,
  ].filter(Boolean);

  return parts.join(' / ') || 'Localizacao pendente';
}

async function buildLabel(db, sample) {
  const storageLocation = sample?.storageLocation || {};
  if (!storageLocation.boxId || !storageLocation.position) {
    const error = new Error('Amostra sem localização física persistida para geração de etiqueta.');
    error.statusCode = 409;
    throw error;
  }

  const sampleId = normalizeString(sample?.sampleID || sample?._id?.toString?.() || sample?._id);
  const barcode = normalizeString(sample?.barcode || sampleId);
  const sprecCode = qualityDomain.buildSprecCode(sample?.sprec || {});
  const storagePathText = await resolveStoragePathText(db, sample);
  const location = buildLocationText(sample, storagePathText);

  return {
    sampleId,
    barcode,
    qrPayload: `BIOAVANCED:SAMPLE:${barcode}`,
    location,
    sprecCode: sprecCode || normalizeString(sample?.sprec_code),
    generatedAt: new Date().toISOString(),
  };
}

function buildZpl(label) {
  const sampleId = escapeZpl(label.sampleId);
  const barcode = escapeZpl(label.barcode);
  const location = escapeZpl(label.location).slice(0, 44);
  const sprec = escapeZpl(label.sprecCode || 'SPREC N/A');

  return [
    '^XA',
    '^CI28',
    '^PW600',
    '^LL320',
    '^FO35,28^A0N,30,30^FDBioAvanceD^FS',
    `^FO35,70^A0N,28,28^FDAmostra: ${sampleId}^FS`,
    `^FO35,110^BCN,80,Y,N,N^FD${barcode}^FS`,
    `^FO35,220^A0N,24,24^FD${location}^FS`,
    `^FO35,255^A0N,22,22^FD${sprec}^FS`,
    '^XZ',
  ].join('\n');
}

function buildSvg(label) {
  const barcode = escapeXml(label.barcode);
  const sampleId = escapeXml(label.sampleId);
  const location = escapeXml(label.location);
  const sprec = escapeXml(label.sprecCode || 'SPREC N/A');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220" viewBox="0 0 420 220" role="img" aria-label="Etiqueta de amostra ${sampleId}">
  <rect width="420" height="220" rx="12" fill="#ffffff" stroke="#0f766e" stroke-width="2"/>
  <text x="24" y="34" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">BioAvanceD</text>
  <text x="24" y="64" font-family="Arial, sans-serif" font-size="16" fill="#0f172a">Amostra: ${sampleId}</text>
  <rect x="24" y="82" width="300" height="58" fill="#111827"/>
  <text x="24" y="164" font-family="Arial, sans-serif" font-size="14" fill="#0f172a">${barcode}</text>
  <text x="24" y="186" font-family="Arial, sans-serif" font-size="13" fill="#334155">${location}</text>
  <text x="24" y="205" font-family="Arial, sans-serif" font-size="12" fill="#475569">${sprec}</text>
</svg>`;
}

function buildHtml(label) {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Etiqueta ${escapeXml(label.sampleId)}</title></head>
<body>${buildSvg(label)}</body>
</html>`;
}

router.get('/samples/:sampleId', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    const sample = await findSample(db, req.params.sampleId);
    if (!sample) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada para geração de etiqueta.' });
    }

    const label = await buildLabel(db, sample);
    const format = normalizeString(req.query.format || 'json').toLowerCase();

    if (format === 'zpl') {
      res.type('text/plain');
      return res.send(buildZpl(label));
    }

    if (format === 'svg') {
      res.type('image/svg+xml');
      return res.send(buildSvg(label));
    }

    if (format === 'html') {
      res.type('text/html');
      return res.send(buildHtml(label));
    }

    return res.json({
      success: true,
      data: {
        ...label,
        zpl: buildZpl(label),
        svg: buildSvg(label),
      },
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({ success: false, error: error?.message || 'Falha ao gerar etiqueta.' });
  }
});

router.get('/samples/:sampleId/print-job', authenticate, requirePermission('createSample'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível.' });
    }

    const sample = await findSample(db, req.params.sampleId);
    if (!sample) {
      return res.status(404).json({ success: false, error: 'Amostra não encontrada para job de impressão.' });
    }

    const label = await buildLabel(db, sample);
    return res.json({
      success: true,
      data: {
        sampleId: label.sampleId,
        format: 'zpl',
        printerLanguage: 'ZPL',
        label,
        zpl: buildZpl(label),
      },
    });
  } catch (error) {
    return res.status(error?.statusCode || error?.status || 500).json({ success: false, error: error?.message || 'Falha ao preparar job de impressão.' });
  }
});

module.exports = router;
