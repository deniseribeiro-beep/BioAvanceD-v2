/**
 * Migration: every stored sample's barcode becomes a LabelIdentifier
 * (ELM-0116 -> V2E-0169, #1378).
 *
 * Sample.barcode is deprecated, "Replaced by LabelIdentifier records"; its
 * migration note asks to transform the legacy value and preserve its
 * provenance. Per sample with a non-blank barcode (a string or a number,
 * read as its trimmed string):
 *
 * - an active label with that value in the legacy-sample-barcode namespace
 *   already on this sample's container: unchanged.
 * - one active for another target: not written, and listed in the summary's
 *   conflicts for a person to resolve.
 * - a value carrying personal data (a CPF, an e-mail, whitespace; RULE-012):
 *   not written, and listed in refused with the reason, without the value.
 * - else issueSpecimenLabel, unprinted, on the sample's one container (its
 *   open load, else its adopted legacy placement, else one created and
 *   loaded), with migratedFrom { elementId, sampleId, value }, issued at the
 *   sample's registeredAt, else createdAt, else the run instant. The rules
 *   are docs/decisions/2026-10-13-specimen-label-issuance.md.
 *
 * The sample document is never modified: Sample.barcode stays for read
 * compatibility.
 *
 * Idempotent: an issued label is found on the second run, which writes
 * nothing.
 *
 * Run `npm run migrate:storage-assignments-to-chain` first, so a placed
 * legacy sample keeps the container its placement was adopted into.
 *
 * One-way: no rollback. The sample document is never modified and each label
 * issued carries migratedFrom, so the labels can be found; but issuing one
 * first ensures the sample's container, and for a sample with no open load
 * and no adopted legacy placement that creates a container and loads the
 * sample into it on the physical chain, whose assignments are append-only, so
 * retiring the labels does not take back the placement. Undo is restoring the
 * label and physical-chain collections from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:sample-barcode-labels               applies
 *   npm run migrate:sample-barcode-labels -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');
const LabelIdentifierModel = require('../models/LabelIdentifier');
const physicalChain = require('../services/physicalChain.service');
const { issueSpecimenLabel, SPECIMEN_LABEL_NAMESPACE_ID } = require('../services/specimenLabel.service');

// The chain's key: a legacy sample with no specimenId is keyed by its _id.
function specimenKeyOf(sample) {
  return String(sample.specimenId || sample._id);
}

function personalDataIn(value) {
  try {
    LabelIdentifierModel.assertNoPersonalData(value);
    return null;
  } catch (error) {
    return error.message;
  }
}

async function migrateSampleBarcodeLabels(db, { dryRun = false } = {}) {
  const samples = getCollection(db, 'samples');
  const labels = getCollection(db, 'labelIdentifiers');
  const runAt = new Date();
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    issued: 0,
    unchanged: 0,
    skippedBlank: 0,
    conflicts: [],
    refused: [],
  };

  const docs = await samples.find({}).toArray();
  for (const sample of docs) {
    summary.scanned += 1;
    const code = String(sample.barcode ?? '').trim();
    if (!code) {
      summary.skippedBlank += 1;
      continue;
    }
    const sampleId = String(sample._id);

    const existing = await labels.findOne({ encodedValue: code, namespaceRegistryId: SPECIMEN_LABEL_NAMESPACE_ID, status: 'active' });
    if (existing) {
      const loaded = await physicalChain.openSpecimenAssignment(db, specimenKeyOf(sample));
      if (loaded && existing.targetType === 'container' && existing.targetId === loaded.containerId) {
        summary.unchanged += 1;
      } else {
        summary.conflicts.push({ sampleId, value: code });
      }
      continue;
    }

    const reason = personalDataIn(code);
    if (reason) {
      summary.refused.push({ sampleId, reason });
      continue;
    }

    if (dryRun) {
      summary.issued += 1;
      continue;
    }
    try {
      await issueSpecimenLabel(db, sample, {
        code,
        actorId: null,
        at: sample.registeredAt || sample.createdAt || runAt,
        printed: false,
        provenance: { elementId: 'ELM-0116', sampleId, value: code },
      });
      summary.issued += 1;
    } catch (error) {
      // A value issued by a concurrent write since it was read.
      if (error?.code !== 'LABEL_EXISTS') throw error;
      summary.conflicts.push({ sampleId, value: code });
    }
  }

  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateSampleBarcodeLabels(db, { dryRun: argv.includes('--dry-run') });
  console.log('Sample.barcode -> LabelIdentifier backfill:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração Sample.barcode -> LabelIdentifier:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateSampleBarcodeLabels, run };
