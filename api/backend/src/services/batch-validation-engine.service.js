const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const ExcelJS = require('exceljs');
const csvParser = require('csv-parser');
const { ObjectId } = require('mongodb');

const StagingImport = require('./stagingImport.store');
const importLGPDService = require('./import-lgpd.service');
const patientService = require('./patient.service');
const participantIdentityService = require('./participantIdentity.service');
const sampleService = require('./sample.service');
const biomarkerObservationService = require('./biomarker-observation.service');
const logger = require('../utils/logger');
const { sealStagedRecord, revealStagedRecord } = require('../utils/stagedRowCrypto');
const { isRecordInOrganizationScope } = require('./rbac-assignment.service');

const CHUNK_SIZE = 100;

// #939: o discriminador proprio deste importador em import_batches /
// import_staging_records. Hard-coded, nao parametrizado -- mesma forma que
// FHIR_BATCH_TYPE em fhir-import-staging.service.js (findFhirBatch), pelo
// mesmo motivo: o endpoint deste importador nao deve confirmar a existencia
// de um lote de outro caminho de importacao (#799).
const ASYNC_BATCH_IMPORT_TYPE = 'ASYNC_BATCH_IMPORT';

class BatchValidationEngine {
  normalizeHeader(header) {
    return String(header || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  normalizeText(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  normalizeDigits(value) {
    if (value === undefined || value === null) return null;
    const digits = String(value).replace(/\D/g, '').trim();
    return digits.length > 0 ? digits : null;
  }

  normalizeCpf(value) {
    const digits = this.normalizeDigits(value);
    return digits && digits.length === 11 ? digits : null;
  }

  normalizePatientID(value) {
    const digits = this.normalizeDigits(value);
    return digits && digits.length === 8 ? digits : null;
  }

  normalizeRecordNumber(value) {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;
    return normalized;
  }

  normalizeObjectId(value) {
    const normalized = this.normalizeText(value);
    if (!normalized || !ObjectId.isValid(normalized)) return null;
    return normalized;
  }

  parseNumericValue(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  normalizeCoding(raw, fallbackSystem, fallbackDisplay) {
    const code = this.normalizeText(raw?.code || raw?.codigo || raw?.id || raw);
    const display = this.normalizeText(raw?.display || raw?.nome || raw?.name || fallbackDisplay);
    const system = this.normalizeText(raw?.system || fallbackSystem);

    if (!code || !system) {
      return null;
    }

    return {
      system,
      code,
      display: display || code,
    };
  }

  extractSemanticCascadeFromRow(rawRow = {}) {
    const normalizedRow = {};
    Object.keys(rawRow || {}).forEach((key) => {
      normalizedRow[this.normalizeHeader(key)] = rawRow[key];
    });

    const diseaseCode = this.normalizeText(
      normalizedRow.orpha
      || normalizedRow.orphacode
      || normalizedRow.diagnosisorphacode
      || normalizedRow.doencaorpha
    );
    const diseaseDisplay = this.normalizeText(
      normalizedRow.orphaname
      || normalizedRow.disease
      || normalizedRow.doenca
    );
    const disease = diseaseCode
      ? this.normalizeCoding({ code: diseaseCode, display: diseaseDisplay }, 'http://www.orpha.net')
      : null;

    const phenotypeSource = this.normalizeText(
      normalizedRow.hpo
      || normalizedRow.hpocode
      || normalizedRow.phenotype
      || normalizedRow.fenotipo
    );
    const phenotypes = phenotypeSource
      ? phenotypeSource
        .split(/[;,|]/)
        .map((token) => this.normalizeCoding({ code: token }, 'http://purl.obolibrary.org/obo/hp.owl'))
        .filter(Boolean)
      : [];

    const biomarkerSource = this.normalizeText(
      normalizedRow.biomarkers
      || normalizedRow.biomarcadores
      || normalizedRow.biomarker
      || normalizedRow.biomarcador
    );
    const biomarkers = biomarkerSource
      ? biomarkerSource
        .split(/[;,|]/)
        .map((token) => this.normalizeCoding({ code: token }, 'http://loinc.org'))
        .filter(Boolean)
      : [];

    const warnings = [];

    if (!disease && (phenotypes.length > 0 || biomarkers.length > 0)) {
      warnings.push('Linha possui fenotipos/biomarcadores sem ORPHA. A cascata semantica pode ficar inconsistente.');
    }

    return {
      disease,
      phenotypes,
      biomarkers,
      warnings,
    };
  }

  async readJsonRows(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw);

    if (Array.isArray(payload)) {
      return payload.filter((row) => row && typeof row === 'object');
    }

    if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.entry)) {
        return payload.entry
          .map((item) => item?.resource || item)
          .filter((row) => row && typeof row === 'object');
      }

      return [payload];
    }

    return [];
  }

  detectCsvSeparator(filePath) {
    const sample = fs.readFileSync(filePath, 'utf8').slice(0, 8192);
    const firstLine = sample
      .split(/\r?\n/)
      .find((line) => line && line.trim().length > 0) || '';

    const candidates = [';', ',', '\t', '|'];
    let bestSeparator = ',';
    let bestScore = -1;

    for (const separator of candidates) {
      const score = firstLine.split(separator).length - 1;
      if (score > bestScore) {
        bestScore = score;
        bestSeparator = separator;
      }
    }

    return bestSeparator;
  }

  async readCsvRows(filePath) {
    return new Promise((resolve, reject) => {
      const rows = [];
      // #1041: ORDER MATTERS -- line tracking first, filter second.
      //
      // csv-parser emits an interior blank line as `{}`, and the old guard
      // (`typeof row === 'object'`) kept it. That empty object occupied an
      // array slot, was counted in totalRows, classified INVALID, and
      // persisted as a durable quarantine record whose `row` was `{}` -- a
      // rejected row an operator can neither correct nor resubmit, for a line
      // carrying no data.
      //
      // Dropping it ALONE would have introduced a defect this reader did not
      // have: the old `index + rowBaseNumber` arithmetic stayed aligned
      // precisely BECAUSE the `{}` held a slot. So the counter below is
      // incremented on EVERY data event and pushed only for rows we keep --
      // the same shape as import-lgpd.service.js's #1023 reader.
      //
      // #1065: the physical line comes from the record's `byteOffset`
      // (csv-parser 3.2.0, `outputByteOffset: true`), not a per-event counter.
      // csv-parser emits one data event per RECORD, so a quoted field with an
      // embedded newline spans several physical lines in one event, and a
      // counter drifts low for every record after it. Same derivation as
      // import-lgpd.service.js#readCSV (#1035), with one difference: that
      // reader already held the whole file, this one streams it. So the 0x0A
      // positions are collected from each chunk as it passes to the parser --
      // a chunk always passes before any record starting in it is emitted --
      // costing 8 bytes per line instead of a resident copy of the file.
      // Bytes, not characters: the corpus is accented Portuguese.
      const newlineByteOffsets = [];
      let bytesSeen = 0;
      const newlineIndexer = new Transform({
        transform(chunk, _encoding, callback) {
          for (let i = 0; i < chunk.length; i += 1) {
            if (chunk[i] === 0x0a) newlineByteOffsets.push(bytesSeen + i);
          }
          bytesSeen += chunk.length;
          callback(null, chunk);
        },
      });
      const physicalLineForByteOffset = (byteOffset) => {
        let lo = 0;
        let hi = newlineByteOffsets.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (newlineByteOffsets[mid] < byteOffset) lo = mid + 1;
          else hi = mid;
        }
        return lo + 1;
      };
      const sourceLines = [];
      const separator = this.detectCsvSeparator(filePath);

      fs.createReadStream(filePath)
        .on('error', reject)
        .pipe(newlineIndexer)
        .pipe(csvParser({ separator, outputByteOffset: true }))
        .on('data', ({ row, byteOffset }) => {
          if (row && typeof row === 'object') {
            const physicalLine = physicalLineForByteOffset(byteOffset);
            const hasData = Object.values(row).some((value) => value && String(value).trim());
            if (hasData) {
              rows.push(row);
              sourceLines.push(physicalLine);
            }
          }
        })
        .on('end', () => {
          // Non-enumerable for the same reason as readXlsxRows' pair: the
          // readers' tests compare the array itself with `toEqual`.
          Object.defineProperty(rows, 'sourceLines', {
            value: sourceLines,
            enumerable: false,
          });
          resolve(rows);
        })
        .on('error', reject);
    });
  }

  async readXlsxRows(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const rows = [];
    // #1041: both index-aligned with `rows`, same pairing convention as
    // import-lgpd.service.js's readCSV/readExcel `sourceLines` (#1023).
    // `sourceLines` stays NUMERIC -- it becomes import_staging_records
    // .rowNumber, which getQuarantineBatch sorts with `.sort({rowNumber: 1})`,
    // so a `<sheet>!<row>` string would silently order lexically. This reader
    // flattens every worksheet into one array, so the sheet name is carried
    // beside the number rather than folded into it.
    const sourceLines = [];
    const sourceSheets = [];

    for (const worksheet of workbook.worksheets) {
      const headerRow = worksheet.getRow(1);
      const headers = [];

      headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const header = String(cell?.text || cell?.value || '').trim();
        if (header) {
          headers[columnNumber - 1] = header;
        }
      });

      if (!headers.length) {
        continue;
      }

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        if (!row || row.actualCellCount === 0) {
          continue;
        }

        const mapped = {};
        headers.forEach((header, index) => {
          if (!header) return;
          const cell = row.getCell(index + 1);
          const value = cell?.text !== undefined && cell?.text !== null && String(cell.text).trim() !== ''
            ? cell.text
            : cell?.value;
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            mapped[header] = value;
          }
        });

        if (Object.keys(mapped).length > 0) {
          rows.push(mapped);
          sourceLines.push(rowNumber);
          sourceSheets.push(worksheet.name);
        }
      }
    }

    // #1041: non-enumerable so the array's own `toEqual` shape (used by the
    // existing readers tests) is unaffected -- same rationale as #1023's
    // sourceLines in import-lgpd.service.js.
    Object.defineProperty(rows, 'sourceLines', {
      value: sourceLines,
      enumerable: false,
    });
    Object.defineProperty(rows, 'sourceSheets', {
      value: sourceSheets,
      enumerable: false,
    });

    return rows;
  }

  async readRowsFromFile(storagePath, fileName = '') {
    const fileExt = path.extname(fileName || storagePath || '').toLowerCase();

    if (fileExt === '.json') {
      return this.readJsonRows(storagePath);
    }

    if (fileExt === '.csv' || fileExt === '.tsv' || fileExt === '.txt') {
      return this.readCsvRows(storagePath);
    }

    if (fileExt === '.xlsx' || fileExt === '.xlsm' || fileExt === '.xltx' || fileExt === '.xls') {
      return this.readXlsxRows(storagePath);
    }

    try {
      return await this.readCsvRows(storagePath);
    } catch (csvError) {
      try {
        return await this.readJsonRows(storagePath);
      } catch (jsonError) {
        return this.readXlsxRows(storagePath);
      }
    }
  }

  buildSampleRow(rawRow = {}) {
    const mapped = {};
    const headerMap = {
      // The #767 failure mode on the participant column: these targeted
      // 'patientID', which parseSampleRow never reads (it reads
      // participantId), and a `participantId` header was not mapped at all,
      // so no batch-imported sample carried its participant's id.
      participantid: 'participantId',
      patientid: 'participantId',
      // The same failure mode on the specimen column: these targeted
      // 'sampleID', which parseSampleRow never reads, so a file's own id was
      // dropped silently. specimenId is the system's internal id (v2.0.0
      // ELM-0114) and createSample generates it; the source system's id is
      // BaseRecord.sourceRecordId (ELM-0011), which RF029 AC#2 requires an
      // ingestion to keep.
      sampleid: 'sourceRecordId',
      specimenid: 'sourceRecordId',
      sourcerecordid: 'sourceRecordId',
      sampletype: 'sampleType',
      tipodeamostra: 'sampleType',
      sampleorigin: 'sampleOrigin',
      origemdasa: 'sampleOrigin',
      origemdadadacoleta: 'sampleOrigin',
      extractionprotocol: 'extractionProtocol',
      protocolodeextracao: 'extractionProtocol',
      // #767: these three used to target 'registrationDate'. e2549bee
      // renamed parseSampleRow's registerDate/registrationDate fallback to
      // the canonical registeredAt, and import-lgpd.service.js has contained
      // zero occurrences of 'registrationDate' ever since -- so the mapped
      // value was never read and every batch-imported sample fell through to
      // `registeredAt = new Date()`. Same failure mode as the #525 note
      // below, on the date column. The header keys stay as they are: those
      // are the user-facing CSV column names and remain correct. Only the
      // target changes, to the name canonical-fields.arch.test.js and
      // sample.routes.js both already treat as the canonical one.
      registerdate: 'registeredAt',
      registrationdate: 'registeredAt',
      datacoleta: 'registeredAt',
      // #525: no target field on purpose. import-lgpd.service.js#parseSampleRow
      // never reads a `locationID` key (#459/#462: CSV rows carry the
      // canonical boxId/positionCode pair directly, "no legacy field aliases
      // in runtime persistence") — mapping these legacy headers onto
      // `locationID` produced a value persistSample() silently discarded.
      // Recognizing the header names is still useful for detectDataType()'s
      // sample-vs-patient heuristic below, so they stay out of that list;
      // they just no longer feed a dead target field here.
      //
      // The canonical pair itself was never mapped, so it was dropped the
      // same way, and createSample, which requires a box and a position,
      // rejected every row this importer handed it.
      boxid: 'boxId',
      positioncode: 'positionCode',
      position: 'positionCode',
      wellposition: 'positionCode',
      linkedproject: 'linkedProject',
      projetovinculado: 'linkedProject',
      currentstatus: 'currentStatus',
      statusatual: 'currentStatus',
      quantity: 'quantity',
      quantidade: 'quantity',
      quality: 'quality',
      qualidade: 'quality',
      barcode: 'barcode',
      codigodebarras: 'barcode',
    };

    Object.keys(rawRow).forEach((sourceColumn) => {
      const normalized = this.normalizeHeader(sourceColumn);
      const targetKey = headerMap[normalized];

      if (targetKey) {
        mapped[targetKey] = rawRow[sourceColumn];
      }
    });

    return mapped;
  }

  classifyPatientRow(rawRow, patientData) {
    const warnings = [];

    if (rawRow.patientID) {
      warnings.push('patientID fornecido será ignorado; o sistema gera o identificador automaticamente');
    }

    if (rawRow.email && String(rawRow.email).trim() !== String(patientData.email || '').trim()) {
      warnings.push('email foi normalizado');
    }

    if (rawRow.phone && String(rawRow.phone).trim() !== String(patientData.phone || '').trim()) {
      warnings.push('phone foi normalizado');
    }

    if (rawRow.clinicalUnit && String(rawRow.clinicalUnit).trim() !== String(patientData.clinicalUnit || '').trim()) {
      warnings.push('clinicalUnit foi normalizada');
    }

    if (patientData.recordNumber === null && rawRow.recordNumber !== undefined && rawRow.recordNumber !== null && String(rawRow.recordNumber).trim() !== '') {
      warnings.push('recordNumber foi descartado por ser vazio ou inválido');
    }

    ['phone', 'recordNumber', 'clinicalUnit', 'unitAcronym', 'cpf'].forEach((field) => {
      if (patientData[field] === null || patientData[field] === undefined || patientData[field] === '') {
        if (field !== 'cpf') {
          warnings.push(`${field} ausente; registro persistirá com valor padrão`);
        }
      }
    });

    return warnings;
  }

  classifySampleRow(rawRow, sampleData) {
    const warnings = [];

    if (!sampleData.extractionProtocol) {
      warnings.push('extractionProtocol ausente; será mantido como nulo');
    }

    if (rawRow.quantity && String(rawRow.quantity).trim() !== String(sampleData.quantity ?? '').trim()) {
      warnings.push('quantity foi normalizada');
    }

    return warnings;
  }

  buildPatientLinkageQuery(rawRow = {}, patientData = {}) {
    const criteria = [];

    const patientID = this.normalizePatientID(
      patientData.participantId || rawRow.participantId || rawRow.patientID || rawRow.patientId || rawRow.patient_id
    );
    if (patientID) {
      // #853: `patients` never persists a `patientID` key (Patient.js's
      // CANONICAL_FIELDS declares `participantId`); an 8-digit patientID
      // column is exactly that canonical participantId, so the filter must
      // be keyed on `participantId` or this criterion never matches.
      criteria.push({ participantId: patientID });
    }

    const cpf = this.normalizeCpf(patientData.cpf || rawRow.cpf || rawRow.representativeCpf);
    if (cpf) {
      criteria.push({ cpf });
    }

    const recordNumber = this.normalizeRecordNumber(patientData.recordNumber || rawRow.recordNumber || rawRow.record_number);
    if (recordNumber) {
      criteria.push({ recordNumber });
      const numericRecordNumber = Number(recordNumber);
      if (Number.isFinite(numericRecordNumber)) {
        criteria.push({ recordNumber: numericRecordNumber });
      }
    }

    const objectIdCandidate = this.normalizeObjectId(
      patientData._id || rawRow._id || rawRow.patientObjectId || rawRow.patient_object_id
    );
    if (objectIdCandidate) {
      criteria.push({ _id: new ObjectId(objectIdCandidate) });
    }

    return criteria;
  }

  // #1386: a blank number runs no identity query.
  async findPatientByIdentityRecordNumber(db, patientsCollection, recordNumber) {
    const recordNumberQuery = participantIdentityService.recordNumberIdentityQuery(recordNumber);
    if (!recordNumberQuery) return null;
    const identity = await db.collection('participantIdentities').findOne(recordNumberQuery);
    return identity ? patientsCollection.findOne({ participantId: identity.participantId }) : null;
  }

  async findLinkedPatient(db, rawRow = {}, patientData = {}) {
    const patientsCollection = db.collection('patients');
    const criteria = this.buildPatientLinkageQuery(rawRow, patientData);

    let identityRecordNumberTried = false;
    for (const filter of criteria) {
      // #1386: a record number is ParticipantIdentity's (P1X-0355), matched
      // on recordNumberHash once. No recordNumber criterion is matched on
      // patients, so a number held only on the legacy patients.recordNumber
      // links nothing.
      if (!identityRecordNumberTried && Object.prototype.hasOwnProperty.call(filter, 'recordNumber')) {
        identityRecordNumberTried = true;
        // eslint-disable-next-line no-await-in-loop
        const identityLinked = await this.findPatientByIdentityRecordNumber(db, patientsCollection, filter.recordNumber);
        if (identityLinked) {
          return identityLinked;
        }
      }
      if (Object.prototype.hasOwnProperty.call(filter, 'recordNumber')) continue;

      // Prioriza a igualdade exata para manter o record linkage previsível.
      // A ordem dos critérios é significativa: patientID, CPF, prontuário e, por fim, _id.
      // eslint-disable-next-line no-await-in-loop
      const matchedPatient = await patientsCollection.findOne(filter);
      if (matchedPatient) {
        return matchedPatient;
      }
    }

    return null;
  }

  buildBiomarkerObservationPayloads(rawRow = {}, patient = {}, specimen = {}) {
    const warnings = [];
    const payloads = [];
    const normalizedRow = {};

    Object.keys(rawRow || {}).forEach((key) => {
      normalizedRow[this.normalizeHeader(key)] = rawRow[key];
    });

    const specimenIdentifier = String(
      specimen?.specimenId
      || specimen?._id
      || specimen?.barcode
      || ''
    ).trim();
    const specimenObjectId = specimen?._id ? String(specimen._id).trim() : null;
    const patientIdentifier = String(patient?.participantId || '').trim();
    const patientObjectId = patient?._id ? String(patient._id).trim() : null;
    // #768: the specimen legs used to read `registrationDate`/`registerDate`,
    // names e2549bee canonicalized away. Sample.js:38 declares `registeredAt`
    // as the only (required) date field and Sample.create() always populates
    // it, so neither old leg could ever fire -- a biomarker row with no date
    // column skipped straight past the specimen to `new Date()` and the
    // observation was stamped with import time instead of the specimen's
    // registration date. Both dead legs are dropped rather than kept
    // alongside the fix: unlike the rawRow legs below they are unreachable
    // under any input, since `specimen` is createSample()'s return value.
    //
    // The rawRow legs stay. persistSample passes the *un-canonicalized* CSV
    // row here (buildSampleRow is what maps headers), so a file whose column
    // is literally spelled `registrationDate` still reaches them -- those are
    // real user input, not a dead internal name.
    const collectedAt = this.parseDateValue(
      rawRow?.collectedAt
      || rawRow?.effectiveDateTime
      || rawRow?.issuedAt
      || rawRow?.registrationDate
      || rawRow?.registerDate
      || specimen?.registeredAt
      || new Date()
    ) || new Date();

    const biomarkerSource = this.normalizeText(
      normalizedRow.biomarkers
      || normalizedRow.biomarcadores
      || normalizedRow.biomarker
      || normalizedRow.biomarcador
    );

    if (!biomarkerSource) {
      return {
        payloads,
        warnings,
      };
    }

    const biomarkerTokens = biomarkerSource
      .split(/[;,|]/)
      .map((token) => this.normalizeText(token))
      .filter(Boolean);

    for (const token of biomarkerTokens) {
      const codeParts = token.split(/[:=]/).map((part) => this.normalizeText(part)).filter(Boolean);
      const biomarkerType = codeParts[0];
      const rawValue = codeParts[1] || null;

      if (!biomarkerType) continue;
      if (!rawValue) {
        warnings.push(`Biomarcador ${biomarkerType} foi ignorado por não informar valor.`);
        continue;
      }

      const numericValue = this.parseNumericValue(rawValue);
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        warnings.push(`Biomarcador ${biomarkerType} foi ignorado por conter valor inválido.`);
        continue;
      }

      payloads.push({
        participantId: patientIdentifier,
        patientObjectId,
        biomarkerType,
        value: numericValue,
        unit: null,
        collectedAt,
        status: 'final',
        source: 'batch-import',
        eventType: 'create',
        linkedResourceType: 'Patient',
        linkedResourceId: patientObjectId || patientIdentifier,
        sampleID: specimenIdentifier,
        sampleId: specimenIdentifier,
        specimenID: specimenIdentifier,
        specimenId: specimenIdentifier,
        specimenObjectId,
        subject: {
          reference: `Patient/${patientObjectId || patientIdentifier}`,
          type: 'Patient',
        },
        specimen: {
          reference: `Specimen/${specimenIdentifier}`,
        },
        effectiveDateTime: collectedAt,
      });
    }

    return {
      payloads,
      warnings,
    };
  }

  detectDataType(rows = [], fileName = '') {
    const normalizedFileName = String(fileName || '').toLowerCase();
    const sampleHints = [
      'sampletype',
      'sampleorigin',
      'extractionprotocol',
      'registrationdate',
      'registerdate',
      'locationid',
      'linkedproject',
      'barcode',
      'quality',
      'biomarkers',
      'specimenid',
      'sampleid',
    ];
    const patientHints = [
      'patientname',
      'birthdate',
      'sex',
      'email',
      'consenttemplateid',
      'cpf',
      'recordnumber',
      'clinicalunit',
      'unitacronym',
      'diagnostichypothesis',
      'icdcode',
    ];

    let sampleScore = 0;
    let patientScore = 0;

    for (const row of rows.slice(0, 10)) {
      const normalizedHeaders = Object.keys(row || {}).map((header) => this.normalizeHeader(header));

      for (const header of normalizedHeaders) {
        if (sampleHints.includes(header)) {
          sampleScore += 1;
        }

        if (patientHints.includes(header)) {
          patientScore += 1;
        }
      }
    }

    if (sampleScore > 0) {
      return 'samples';
    }

    if (patientScore > 0) {
      return 'patients';
    }

    if (normalizedFileName.includes('sample') || normalizedFileName.includes('specimen') || normalizedFileName.includes('amostra')) {
      return 'samples';
    }

    return 'patients';
  }

  /**
   * Processa uma linha de paciente em importação em lote.
   */
  async persistPatient(db, rawRow, rowNumber, context = {}, mappedRow = null) {
    const sourceRow = mappedRow || rawRow;
    const patientData = importLGPDService.parsePatientRow(sourceRow);
    patientData.patientName = patientData.patientName ? String(patientData.patientName).trim() : null;
    patientData.email = patientData.email ? String(patientData.email).trim().toLowerCase() : null;
    patientData.phone = patientData.phone ? String(patientData.phone).trim() : null;
    patientData.clinicalUnit = patientData.clinicalUnit ? String(patientData.clinicalUnit).trim() : null;
    patientData.unitAcronym = patientData.unitAcronym ? String(patientData.unitAcronym).trim() : null;
    patientData.consentTemplateId = patientData.consentTemplateId ? String(patientData.consentTemplateId).trim() : null;

    const validationErrors = [];

    if (!patientData.patientName) {
      validationErrors.push('patientName é obrigatório');
    }
    if (!patientData.birthDate || !(patientData.birthDate instanceof Date) || Number.isNaN(patientData.birthDate.getTime())) {
      validationErrors.push('birthDate é obrigatório e deve ser válida');
    }
    if (!patientData.sex) {
      validationErrors.push('sex é obrigatório');
    }
    if (!patientData.email || !patientData.email.includes('@')) {
      validationErrors.push('email é obrigatório e deve ser válido');
    }
    if (!patientData.consentTemplateId) {
      validationErrors.push('consentTemplateId é obrigatório');
    }

    if (validationErrors.length > 0) {
      return {
        classification: 'INVALID',
        rowNumber,
        errors: validationErrors,
        warnings: [],
      };
    }

    const warnings = this.classifyPatientRow(rawRow, patientData);

    try {
      const created = await patientService.createPatient(db, patientData, {
        isBatchImport: true,
        batchImport: true,
        source: 'batch-import',
        ...context,
      });

      return {
        classification: warnings.length > 0 ? 'PARTIAL' : 'VALID',
        rowNumber,
        warnings,
        errors: [],
        persistedId: created?._id?.toString?.() || created?._id || null,
      };
    } catch (error) {
      logger.error('Erro ao persistir paciente no batch import:', error.message);
      return {
        classification: 'INVALID',
        rowNumber,
        warnings,
        errors: [error.message || 'Erro ao persistir paciente'],
      };
    }
  }

  /**
   * Processa uma linha de amostra em cenário de follow-up clínico.
   *
   * Fluxo de record linkage:
   * 1. Procura o paciente por identificadores estáveis informados na linha
   *    (participantId ou a coluna patientID, CPF, prontuário ou _id legado).
   * 2. Se o paciente existir, reutiliza o _id interno de MongoDB.
   * 3. Se não existir, cria um novo Patient e captura o novo _id.
   * 4. Cria a Specimen vinculada ao participantId do paciente e ao patientObjectId interno.
   * 5. Cria Observations apenas quando a linha traz biomarcadores válidos.
   *
   * Isso permite importar follow-ups clínicos sem duplicar pacientes e sem
   * bloquear linhas históricas que contenham apenas inventário de amostras.
   */
  async persistSample(db, rawRow, rowNumber, context = {}) {
    // #1376, #1192: the uploader's organization stamps the sample only; the
    // participant created below gets none from it.
    const { organizationId = null, ...rowContext } = context;
    const sampleData = importLGPDService.parseSampleRow(this.buildSampleRow(rawRow));
    // RNF018 AC5 (#1524): a JSON row's governanceEvidence references reach
    // createSample, which resolves them against the stored records before it
    // certifies, as POST /api/samples does. buildSampleRow maps no such
    // column, so a CSV or XLSX row presents none and its criteria stay null.
    if (rawRow && Object.prototype.hasOwnProperty.call(rawRow, 'governanceEvidence')) {
      sampleData.governanceEvidence = rawRow.governanceEvidence;
    }
    sampleData.participantId = sampleData.participantId ? String(sampleData.participantId).trim() : null;
    sampleData.sampleType = sampleData.sampleType ? String(sampleData.sampleType).trim() : null;
    sampleData.sampleOrigin = sampleData.sampleOrigin ? String(sampleData.sampleOrigin).trim() : null;
    sampleData.extractionProtocol = sampleData.extractionProtocol ? String(sampleData.extractionProtocol).trim() : null;
    sampleData.barcode = sampleData.barcode ? String(sampleData.barcode).trim() : null;
    sampleData.linkedProject = sampleData.linkedProject ? String(sampleData.linkedProject).trim() : null;
    sampleData.quantity = sampleData.quantity === null || sampleData.quantity === undefined ? null : Number(sampleData.quantity);
    sampleData.quality = sampleData.quality === null || sampleData.quality === undefined ? sampleData.quality : Number(sampleData.quality);

    const semanticCascade = this.extractSemanticCascadeFromRow(rawRow);

    const validationErrors = [];
    const warnings = [...this.classifySampleRow(rawRow, sampleData), ...semanticCascade.warnings];

    if (!sampleData.sampleType) {
      validationErrors.push('sampleType é obrigatório');
    }
    if (!sampleData.sampleOrigin) {
      validationErrors.push('sampleOrigin é obrigatório');
    }
    if (sampleData.quantity === null || sampleData.quantity === undefined || Number.isNaN(Number(sampleData.quantity)) || Number(sampleData.quantity) <= 0) {
      validationErrors.push('quantity deve ser um número maior que zero');
    }
    if (!semanticCascade.disease) {
      const hasLooseDiseaseText = this.normalizeText(rawRow?.disease || rawRow?.doenca || rawRow?.orphaName || rawRow?.diagnosis);
      if (hasLooseDiseaseText) {
        validationErrors.push('Doenca informada sem codigo ORPHA estruturado (campo orpha/orphaCode).');
      }
    }

    if (validationErrors.length > 0) {
      return {
        classification: 'INVALID',
        rowNumber,
        errors: validationErrors,
        warnings,
      };
    }

    try {
      const patientData = importLGPDService.parsePatientRow(rawRow);
      patientData.patientName = patientData.patientName ? String(patientData.patientName).trim() : null;
      patientData.email = patientData.email ? String(patientData.email).trim().toLowerCase() : null;
      patientData.phone = patientData.phone ? String(patientData.phone).trim() : null;
      patientData.clinicalUnit = patientData.clinicalUnit ? String(patientData.clinicalUnit).trim() : null;
      patientData.unitAcronym = patientData.unitAcronym ? String(patientData.unitAcronym).trim() : null;
      patientData.consentTemplateId = patientData.consentTemplateId ? String(patientData.consentTemplateId).trim() : null;

      let patient = await this.findLinkedPatient(db, rawRow, patientData);
      if (!patient) {
        if (!patientData.patientName || !patientData.birthDate || !patientData.sex || !patientData.email || !patientData.consentTemplateId) {
          return {
            classification: 'INVALID',
            rowNumber,
            errors: ['Paciente não encontrado e dados insuficientes para criar um novo registro. Informe os campos do paciente ou um identificador já existente.'],
            warnings,
          };
        }

        patient = await patientService.createPatient(db, patientData, {
          isBatchImport: true,
          batchImport: true,
          source: 'batch-import',
          skipConsentNotification: true,
          skipBiomarkerArtifacts: true,
          ...rowContext,
        });
      }

      // The linked or created patient is the authority for the id, as it is
      // in import-lgpd's importSamples.
      sampleData.participantId = String(patient.participantId || sampleData.participantId || '').trim();
      sampleData.patientObjectId = String(patient._id || '').trim();
      sampleData.semanticCascade = {
        disease: semanticCascade.disease,
        phenotypes: semanticCascade.phenotypes,
        biomarkers: semanticCascade.biomarkers,
      };

      // #1376: as POST /api/samples does, an unnamed collection site defaults
      // to the uploader's organization. buildSampleRow maps no site column.
      if (organizationId && (sampleData.collectionSite === undefined || sampleData.collectionSite === null || sampleData.collectionSite === '')) {
        sampleData.collectionSite = organizationId;
      }

      const createdSample = await sampleService.createSample(db, sampleData, {
        isImport: true,
        batchImport: true,
        source: 'batch-import',
        ...rowContext,
        organizationId,
      });

      const biomarkerPayloads = this.buildBiomarkerObservationPayloads(rawRow, patient, createdSample);
      const observationWarnings = biomarkerPayloads.warnings || [];
      const observationIds = [];

      for (const payload of biomarkerPayloads.payloads) {
        // Observations são criadas somente para biomarcadores válidos.
        // eslint-disable-next-line no-await-in-loop
        const createdObservation = await biomarkerObservationService.createObservation(db, payload);
        observationIds.push(createdObservation?._id?.toString?.() || createdObservation?._id || null);
      }

      const allWarnings = [...warnings, ...observationWarnings].filter(Boolean);

      return {
        classification: allWarnings.length > 0 ? 'PARTIAL' : 'VALID',
        rowNumber,
        warnings: allWarnings,
        errors: [],
        persistedId: createdSample?._id?.toString?.() || createdSample?._id || null,
        persistedIds: [
          patient?._id?.toString?.() || patient?._id || null,
          createdSample?._id?.toString?.() || createdSample?._id || null,
          ...observationIds,
        ].filter(Boolean),
      };
    } catch (error) {
      logger.error('Erro ao processar follow-up clínico no batch import:', error.message);
      return {
        classification: 'INVALID',
        rowNumber,
        warnings,
        errors: [error.message || 'Erro ao processar follow-up clínico'],
      };
    }
  }

  async updateProgress(jobId, patch = {}) {
    await StagingImport.updateOne(
      { jobId },
      {
        $set: {
          ...patch,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Records a single failed processing attempt (#900). bullmq's Worker runs
   * the processor's catch once per attempt, not once per job -- moveToFailed()
   * is called on every attempt and the retry-vs-fail decision happens inside
   * it, after the processor has already rejected. updateProgress() is
   * $set-only and would clobber importErrors already accumulated by earlier
   * rows/attempts, so this is a separate method rather than a new argument to
   * that one.
   *
   * Only marks the document `failed` when this was the last allowed attempt;
   * otherwise the status is left as `processing`, since bullmq may still
   * retry and the run may yet complete. The schema enum only allows
   * ['staged','queued','processing','completed','failed'], so there is no
   * "retrying" status to set instead.
   *
   * The pushed entry's shape mirrors what staging-import.service.js already
   * pushes onto importErrors on its own failure path, so the two writers
   * stay consistent.
   */
  async recordAttemptFailure(jobId, { attemptNumber, attemptsAllowed, message } = {}) {
    const isFinalAttempt = attemptNumber >= attemptsAllowed;

    await StagingImport.updateOne(
      { jobId },
      {
        $set: {
          status: isFinalAttempt ? 'failed' : 'processing',
          updatedAt: new Date(),
        },
        $push: {
          importErrors: {
            message: `Tentativa ${attemptNumber}/${attemptsAllowed} falhou: ${message || 'erro desconhecido'}`,
            occurredAt: new Date(),
          },
        },
      }
    );
  }

  /**
   * Coloca as linhas rejeitadas em quarentena (#813, RNF011 AC#4 / RF029 AC#6).
   *
   * Este e o importador que o operador realmente alcanca (/import ->
   * POST /api/import/batch). Ate aqui ele classificava as linhas
   * VALID/PARTIAL/INVALID e empilhava `{row: <numero da linha>, errors}` em
   * StagingImport.importErrors -- o campo se chama `row` mas guarda um inteiro,
   * entao o *dado* da linha rejeitada nunca era persistido. Dava para ler o
   * que estava errado, nunca para corrigir e reenviar.
   *
   * Escreve na mesma dupla de colecoes que a importacao LGPD
   * (`import_batches` + `import_staging_records`, #787) para que exista uma
   * so representacao de quarentena, com `type` proprio: os leitores da LGPD
   * e do FHIR filtram por `type` e nao podem passar a listar lotes deste
   * importador por acidente (#799 foi exatamente esse defeito).
   */
  async quarantineRejectedRows(db, { jobId, dataType, fileName = null, rejected = [], counts = {}, organizationId = null } = {}) {
    if (!Array.isArray(rejected) || rejected.length === 0) return null;
    if (!db) return null;
    // #1385: the uploader's organization (#1376), stamped on the batch and
    // on each row; getQuarantineBatch checks it against the reader's scope.
    const batchOrganizationId = organizationId == null ? null : String(organizationId);

    // #813/#807: todo tipo de dado vai para a quarentena, inclusive
    // pacientes. Uma linha de paciente carrega patientName/birthDate/email, e
    // por isso `row` e selado em repouso (stagedRowCrypto), como os mesmos
    // valores ja sao em participantIdentities (#566).

    // #1295: as linhas sao gravadas ANTES do lote. Quem encontra o lote (a
    // rota de quarentena, ou quem espera pelo jobId) encontra tambem as suas
    // linhas; na ordem inversa havia uma janela com o lote visivel e vazio.
    const batchId = new ObjectId();
    let rowsWritten = false;
    try {
      const now = new Date();

      await db.collection('import_staging_records').insertMany(
        rejected.map((rejection) => sealStagedRecord({
          batchId,
          rowNumber: rejection.rowNumber,
          // #1041: additive and .xlsx-only. rowNumber stays numeric so the
          // `.sort({rowNumber: 1})` in getQuarantineBatch keeps ordering
          // numerically.
          sheet: rejection.sheet ?? null,
          status: 'ERROR',
          errors: rejection.errors || [],
          validationErrors: rejection.errors || [],
          // A linha original como foi lida do arquivo. Sem ela o registro em
          // quarentena pode ser revisado mas nao corrigido e reenviado, que e
          // a razao de existir quarentena em vez de log.
          row: rejection.row ?? null,
          organizationId: batchOrganizationId,
          createdAt: now,
          updatedAt: now,
        }))
      );
      rowsWritten = true;

      await db.collection('import_batches').insertOne({
        _id: batchId,
        type: 'ASYNC_BATCH_IMPORT',
        source: 'ASYNC_BATCH',
        status: 'QUARANTINED',
        jobId: jobId ? String(jobId) : null,
        fileName: fileName ? String(fileName) : null,
        dataType,
        organizationId: batchOrganizationId,
        counts: {
          total: counts.total ?? null,
          success: counts.success ?? null,
          errors: rejected.length,
        },
        createdAt: now,
        updatedAt: now,
      });

      logger.warn(
        `[BATCH_IMPORT] ${rejected.length} linha(s) rejeitada(s) colocadas em quarentena (batch ${batchId})`
      );

      return batchId;
    } catch (stagingError) {
      // A quarentena e um registro anexado a uma importacao que ja rodou;
      // falhar aqui nao pode transformar uma importacao parcial em falha.
      logger.error(
        'Falha ao colocar linhas rejeitadas em quarentena (RNF011 AC#4):',
        stagingError.message || stagingError
      );
      // #1295: sem o lote, as linhas gravadas nao tem quem as leia.
      if (rowsWritten) {
        await db.collection('import_staging_records').deleteMany({ batchId }).catch(() => {});
      }
      return null;
    }
  }

  /**
   * Resolve um lote deste importador, ou 404 (#939, precedente em #799).
   *
   * 404 em vez de 403 deliberadamente: o endpoint deste importador nao deve
   * confirmar a existencia de um lote pertencente a outro caminho de
   * importacao (LGPD/FHIR) que compartilha as mesmas colecoes -- mesmo
   * raciocinio de `findFhirBatch` em fhir-import-staging.service.js.
   */
  async findAsyncBatchImport(db, batchId) {
    const batch = await db.collection('import_batches').findOne({ _id: batchId, type: ASYNC_BATCH_IMPORT_TYPE });
    if (!batch) {
      const error = new Error('Lote de importação em lote não encontrado.');
      error.statusCode = 404;
      throw error;
    }
    return batch;
  }

  /**
   * Le de volta um lote de quarentena que `quarantineRejectedRows` escreveu,
   * mais suas linhas em `import_staging_records` (#939). Ate aqui nada lia
   * esses lotes de volta -- os leitores da LGPD e do FHIR filtram para os
   * proprios tipos e descartam (LGPD) ou nunca souberam (FHIR) de
   * `ASYNC_BATCH_IMPORT`.
   */
  async getQuarantineBatch(db, batchIdRaw, { organizationScope } = {}) {
    const raw = String(batchIdRaw || '').trim();
    if (!ObjectId.isValid(raw)) {
      const error = new Error('Identificador de lote de importação inválido.');
      error.statusCode = 400;
      throw error;
    }

    const batchId = new ObjectId(raw);
    const batch = await this.findAsyncBatchImport(db, batchId);
    // #1385: a reader with organization scope reaches only a batch stamped
    // with one of its organizations; an unstamped batch (legacy, or uploaded
    // by a global caller who named none) only global scope reaches. No scope
    // passed means an internal caller, which is unfiltered.
    if (organizationScope && !isRecordInOrganizationScope(batch, organizationScope, 'organizationId')) {
      const error = new Error('Lote de quarentena fora do escopo organizacional do usuário.');
      error.statusCode = 403;
      throw error;
    }
    const records = await db
      .collection('import_staging_records')
      .find({ batchId })
      .sort({ rowNumber: 1 })
      .toArray();

    // #807: rows are sealed at rest; the reader gets them back as staged.
    return { batch, records: records.map(revealStagedRecord) };
  }

  async processBatchImport(db, stagingImportId, job = null) {
    const stagingImport = await StagingImport.findOne({ jobId: stagingImportId }, db);

    if (!stagingImport) {
      throw new Error(`StagingImport não encontrado para jobId ${stagingImportId}`);
    }

    const storagePath = stagingImport.rawData?.storagePath;
    const fileName = stagingImport.fileName;
    // #1376: stamped at upload by createStagingImport.
    const organizationId = stagingImport.rawData?.organizationId || null;

    if (!storagePath || !fs.existsSync(storagePath)) {
      throw new Error('Arquivo bruto do staging não encontrado');
    }

    await this.updateProgress(stagingImportId, {
      status: 'processing',
      processedRows: 0,
      totalRows: 0,
      importErrors: [],
    });

    const rows = await this.readRowsFromFile(storagePath, fileName);
    if (!rows.length) {
      throw new Error('Arquivo não contém registros válidos para processar');
    }

    const dataType = this.detectDataType(rows, fileName);
    const fileExt = path.extname(fileName || '').toLowerCase();
    const rowBaseNumber = fileExt === '.json' ? 1 : 2;
    const result = {
      jobId: stagingImportId,
      dataType,
      totalRows: rows.length,
      processedRows: 0,
      validRows: 0,
      partialRows: 0,
      invalidRows: 0,
      errors: [],
      warnings: [],
      persistedIds: [],
    };

    await this.updateProgress(stagingImportId, {
      totalRows: rows.length,
      rawData: {
        ...stagingImport.rawData,
        detectedType: dataType,
      },
    });

    // #813: rejected rows, kept with their original data for quarantine.
    const rejectedRows = [];

    const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CHUNK_SIZE;
      const chunk = rows.slice(start, start + CHUNK_SIZE);

      for (let offset = 0; offset < chunk.length; offset += 1) {
        const rawRow = chunk[offset];
        // #1041: readXlsxRows carries the TRUE sheet row on
        // `rows.sourceLines`, index-aligned with `rows`, and the worksheet it
        // came from on `rows.sourceSheets`. Prefer them when present; the
        // CSV/JSON readers attach neither, so this falls back to the original
        // arithmetic for them, unchanged. `rowNumber` stays a number -- see
        // the reader's comment for why the sheet is not folded into it.
        const absoluteIndex = start + offset;
        const sourceLine = rows.sourceLines ? rows.sourceLines[absoluteIndex] : undefined;
        const sourceSheet = rows.sourceSheets ? rows.sourceSheets[absoluteIndex] : undefined;
        const rowNumber = sourceLine !== undefined ? sourceLine : absoluteIndex + rowBaseNumber;

        const rowResult = dataType === 'samples'
          ? await this.persistSample(db, rawRow, rowNumber, { organizationId })
          : await this.persistPatient(db, rawRow, rowNumber);

        result.processedRows += 1;

        if (rowResult.classification === 'VALID') {
          result.validRows += 1;
        } else if (rowResult.classification === 'PARTIAL') {
          result.partialRows += 1;
        } else {
          result.invalidRows += 1;
        }

        if (rowResult.warnings?.length) {
          result.warnings.push({
            row: rowNumber,
            ...(sourceSheet !== undefined ? { sheet: sourceSheet } : {}),
            classification: rowResult.classification,
            warnings: rowResult.warnings,
          });
        }

        if (rowResult.errors?.length) {
          const errorEntry = {
            row: rowNumber,
            // #1041: only present for .xlsx, where one flat array spans every
            // worksheet and the number alone names no unique cell.
            ...(sourceSheet !== undefined ? { sheet: sourceSheet } : {}),
            classification: rowResult.classification,
            errors: rowResult.errors,
          };
          result.errors.push(errorEntry);
          // #813: `errorEntry.row` is the line *number*. Keep the row itself
          // too, so the quarantine below can persist something an operator
          // can actually correct and resubmit.
          rejectedRows.push({
            rowNumber,
            ...(sourceSheet !== undefined ? { sheet: sourceSheet } : {}),
            row: rawRow,
            errors: rowResult.errors,
            classification: rowResult.classification,
          });
          await StagingImport.updateOne(
            { jobId: stagingImportId },
            { $push: { importErrors: errorEntry } },
            db
          );
        }

        if (rowResult.persistedId) {
          result.persistedIds.push(rowResult.persistedId);
        }

        if (job?.updateProgress) {
          const progress = Math.min(100, Math.round((result.processedRows / result.totalRows) * 100));
          await job.updateProgress(progress);
        }
      }

      await this.updateProgress(stagingImportId, {
        processedRows: result.processedRows,
      });
    }

    // #813 (RNF011 AC#4 / RF029 AC#6): rejected rows go to staging/quarantine
    // rather than being discarded once the job document ages out.
    const quarantineBatchId = await this.quarantineRejectedRows(db, {
      jobId: stagingImportId,
      dataType,
      fileName,
      rejected: rejectedRows,
      counts: { total: result.totalRows, success: result.validRows },
      organizationId,
    });
    if (quarantineBatchId) {
      result.quarantineBatchId = String(quarantineBatchId);
    }

    const finalStatus = result.invalidRows > 0 && result.validRows === 0 && result.partialRows === 0
      ? 'failed'
      : 'completed';

    await this.updateProgress(stagingImportId, {
      status: finalStatus,
      processedRows: result.processedRows,
      rawData: {
        ...stagingImport.rawData,
        detectedType: dataType,
        summary: {
          totalRows: result.totalRows,
          validRows: result.validRows,
          partialRows: result.partialRows,
          invalidRows: result.invalidRows,
          // #813: where the rejected rows went, so the job document points at
          // its own quarantine instead of leaving it orphaned.
          quarantineBatchId: quarantineBatchId ? String(quarantineBatchId) : null,
        },
      },
    });

    logger.info(`Batch import concluído para ${stagingImportId}: ${result.validRows} VALID, ${result.partialRows} PARTIAL, ${result.invalidRows} INVALID`);

    return result;
  }
}

module.exports = new BatchValidationEngine();
