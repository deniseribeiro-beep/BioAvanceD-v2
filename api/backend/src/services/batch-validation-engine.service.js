const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const csvParser = require('csv-parser');
const { ObjectId } = require('mongodb');

const StagingImport = require('../models/StagingImport');
const importLGPDService = require('./import-lgpd.service');
const patientService = require('./patient.service');
const sampleService = require('./sample.service');
const biomarkerObservationService = require('./biomarker-observation.service');
const logger = require('../utils/logger');

const CHUNK_SIZE = 100;

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
      const separator = this.detectCsvSeparator(filePath);

      fs.createReadStream(filePath)
        .pipe(csvParser({ separator }))
        .on('data', (row) => {
          if (row && typeof row === 'object') {
            rows.push(row);
          }
        })
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }

  async readXlsxRows(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const rows = [];

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
        }
      }
    }

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
      patientid: 'patientID',
      sampleid: 'sampleID',
      specimenid: 'sampleID',
      sampletype: 'sampleType',
      tipodeamostra: 'sampleType',
      sampleorigin: 'sampleOrigin',
      origemdasa: 'sampleOrigin',
      origemdadadacoleta: 'sampleOrigin',
      extractionprotocol: 'extractionProtocol',
      protocolodeextracao: 'extractionProtocol',
      registerdate: 'registrationDate',
      registrationdate: 'registrationDate',
      datacoleta: 'registrationDate',
      // #525: no target field on purpose. import-lgpd.service.js#parseSampleRow
      // never reads a `locationID` key (#459/#462: CSV rows carry the
      // canonical boxId/positionCode pair directly, "no legacy field aliases
      // in runtime persistence") — mapping these legacy headers onto
      // `locationID` produced a value persistSample() silently discarded.
      // Recognizing the header names is still useful for detectDataType()'s
      // sample-vs-patient heuristic below, so they stay out of that list;
      // they just no longer feed a dead target field here.
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
      patientData.patientID || rawRow.patientID || rawRow.patientId || rawRow.patient_id
    );
    if (patientID) {
      criteria.push({ patientID });
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

  async findLinkedPatient(db, rawRow = {}, patientData = {}) {
    const patientsCollection = db.collection('patients');
    const criteria = this.buildPatientLinkageQuery(rawRow, patientData);

    for (const filter of criteria) {
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
      specimen?.sampleID
      || specimen?.sampleId
      || specimen?._id
      || specimen?.barcode
      || ''
    ).trim();
    const specimenObjectId = specimen?._id ? String(specimen._id).trim() : null;
    const patientIdentifier = String(patient?.patientID || rawRow.patientID || '').trim();
    const patientObjectId = patient?._id ? String(patient._id).trim() : null;
    const collectedAt = this.parseDateValue(
      rawRow.collectedAt
      || rawRow.effectiveDateTime
      || rawRow.issuedAt
      || rawRow.registrationDate
      || rawRow.registerDate
      || specimen?.registrationDate
      || specimen?.registerDate
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
        patientID: patientIdentifier,
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
   *    (CPF, prontuário, patientID ou _id legado).
   * 2. Se o paciente existir, reutiliza o _id interno de MongoDB.
   * 3. Se não existir, cria um novo Patient e captura o novo _id.
   * 4. Cria a Specimen vinculada ao patientID legado e ao patientObjectId interno.
   * 5. Cria Observations apenas quando a linha traz biomarcadores válidos.
   *
   * Isso permite importar follow-ups clínicos sem duplicar pacientes e sem
   * bloquear linhas históricas que contenham apenas inventário de amostras.
   */
  async persistSample(db, rawRow, rowNumber, context = {}) {
    const sampleData = importLGPDService.parseSampleRow(this.buildSampleRow(rawRow));
    sampleData.patientID = sampleData.patientID ? String(sampleData.patientID).trim() : null;
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
          ...context,
        });
      }

      sampleData.patientID = String(patient.patientID || sampleData.patientID || '').trim();
      sampleData.patientObjectId = String(patient._id || '').trim();
      sampleData.semanticCascade = {
        disease: semanticCascade.disease,
        phenotypes: semanticCascade.phenotypes,
        biomarkers: semanticCascade.biomarkers,
      };

      const createdSample = await sampleService.createSample(db, sampleData, {
        isImport: true,
        batchImport: true,
        source: 'batch-import',
        ...context,
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

  async processBatchImport(db, stagingImportId, job = null) {
    const stagingImport = await StagingImport.findOne({ jobId: stagingImportId });

    if (!stagingImport) {
      throw new Error(`StagingImport não encontrado para jobId ${stagingImportId}`);
    }

    const storagePath = stagingImport.rawData?.storagePath;
    const fileName = stagingImport.fileName;

    if (!storagePath || !fs.existsSync(storagePath)) {
      throw new Error('Arquivo bruto do staging não encontrado');
    }

    await this.updateProgress(stagingImportId, {
      status: 'processing',
      processedRows: 0,
      totalRows: 0,
      errors: [],
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

    const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CHUNK_SIZE;
      const chunk = rows.slice(start, start + CHUNK_SIZE);

      for (let offset = 0; offset < chunk.length; offset += 1) {
        const rawRow = chunk[offset];
        const rowNumber = start + offset + rowBaseNumber;

        const rowResult = dataType === 'samples'
          ? await this.persistSample(db, rawRow, rowNumber)
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
            classification: rowResult.classification,
            warnings: rowResult.warnings,
          });
        }

        if (rowResult.errors?.length) {
          const errorEntry = {
            row: rowNumber,
            classification: rowResult.classification,
            errors: rowResult.errors,
          };
          result.errors.push(errorEntry);
          await StagingImport.updateOne(
            { jobId: stagingImportId },
            { $push: { errors: errorEntry } }
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
        },
      },
    });

    logger.info(`Batch import concluído para ${stagingImportId}: ${result.validRows} VALID, ${result.partialRows} PARTIAL, ${result.invalidRows} INVALID`);

    return result;
  }
}

module.exports = new BatchValidationEngine();
