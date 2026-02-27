const logger = require('../utils/logger');
const env = require('../config/env');
const { ObjectId } = require('mongodb');
const PatientFHIR = require('../models/fhir/Patient.fhir.model');
const SampleFHIR = require('../models/fhir/Sample.fhir.model');
const ConsentFHIR = require('../models/fhir/Consent.fhir.model');
const { getCollection, resolveSourceCollectionName } = require('../utils/collectionResolver');
const { buildNeo4jSemanticPointer } = require('../infrastructure/integration/semantic-pointer');

class FhirSyncService {
  mapSexToFhirGender(sex) {
    if (sex === 'M') return 'male';
    if (sex === 'F') return 'female';
    if (sex === 'O') return 'other';
    return 'unknown';
  }

  mapSampleStatusToFhir(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized.includes('available')) return 'available';
    if (normalized.includes('unusable') || normalized.includes('destroyed') || normalized.includes('expired')) return 'unsatisfactory';
    if (normalized.includes('withdrawn') || normalized.includes('depleted') || normalized.includes('unavailable')) return 'unavailable';
    return 'available';
  }

  mapConsentStatusToFhir(status) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'ACTIVE') return 'active';
    if (normalized === 'REVOKED') return 'inactive';
    return 'draft';
  }

  mapSexFromFhirGender(gender) {
    if (gender === 'male') return 'M';
    if (gender === 'female') return 'F';
    if (gender === 'other') return 'O';
    return 'N';
  }

  mapSampleStatusFromFhir(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'available') return 'Available';
    if (normalized === 'unavailable') return 'PartiallyWithdrawn';
    if (normalized === 'unsatisfactory') return 'Unusable';
    return 'Available';
  }

  mapConsentStatusFromFhir(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'active') return 'ACTIVE';
    if (normalized === 'inactive') return 'REVOKED';
    return 'DRAFT';
  }

  isFhirReadPrimary() {
    return String(env.FHIR_READ_MODE || 'fhir-first').toLowerCase() === 'fhir-first';
  }

  async canReadCollection(db, collectionName) {
    if (!this.isFhirReadPrimary()) return false;
    try {
      const collection = db.collection(collectionName);
      if (!collection || typeof collection.findOne !== 'function') {
        return false;
      }
      if (typeof collection.estimatedDocumentCount !== 'function') {
        return true;
      }
      const count = await collection.estimatedDocumentCount();
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  mapPatientFhirToLegacy(doc) {
    if (!doc) return null;
    const primaryName = Array.isArray(doc.name) && doc.name.length > 0 ? doc.name[0] : null;
    const given = Array.isArray(primaryName?.given) ? primaryName.given.filter(Boolean) : [];
    const fullName = primaryName?.text || [given.join(' '), primaryName?.family].filter(Boolean).join(' ').trim();
    const profile = doc.clinicalProfile || {};

    return {
      _id: doc._id,
      patientID: doc.patientID,
      patientName: fullName || 'Paciente',
      sex: this.mapSexFromFhirGender(doc.gender),
      birthDate: doc.birthDate,
      recordNumber: doc.recordNumber,
      unitAcronym: doc.unitAcronym,
      clinicalUnit: doc.clinicalUnit,
      diagnosticHypothesis: profile.diagnosticHypothesis || null,
      icdCode: profile.icdCode || null,
      hypertension: Boolean(profile.hypertension),
      obesity: Boolean(profile.obesity),
      diabetesType1: Boolean(profile.diabetesType1),
      diabetesType2: Boolean(profile.diabetesType2),
      copd: Boolean(profile.copd),
      ckd: Boolean(profile.ckd),
      asthma: Boolean(profile.asthma),
      smoking: Boolean(profile.smoking),
      alcoholUse: Boolean(profile.alcoholUse),
      antibioticUse: Boolean(profile.antibioticUse),
      antiviralUse: Boolean(profile.antiviralUse),
      insulinUse: Boolean(profile.insulinUse),
      geneticVariant: profile.geneticVariant || null,
      alphaGal: profile.alphaGal ?? null,
      lysoGb3: profile.lysoGb3 ?? null,
      status: doc.active ? 'ACTIVE' : 'INACTIVE',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  mapSampleFhirToLegacy(doc) {
    if (!doc) return null;
    const identifier = Array.isArray(doc.identifier) && doc.identifier.length > 0 ? doc.identifier[0] : null;
    const typeCoding = doc.type?.coding?.[0] || {};
    const mongoSampleId = doc.semanticPointers?.mongoSampleId;
    const normalizedId = ObjectId.isValid(mongoSampleId)
      ? new ObjectId(mongoSampleId)
      : (mongoSampleId || doc._id);

    return {
      _id: normalizedId,
      sampleID: doc.sampleID || identifier?.value || null,
      patientID: doc.patientID,
      sampleType: doc.type?.text || typeCoding.display || typeCoding.code || null,
      sampleOrigin: doc.sampleOrigin,
      extractionProtocol: doc.extractionProtocol,
      linkedProject: doc.linkedProject,
      quality: doc.quality,
      quantity: doc.quantity?.value,
      unit: doc.quantity?.unit || 'µL',
      barcode: doc.barcode || doc.sampleID || identifier?.value || null,
      registrationDate: doc.receivedTime,
      currentStatus: this.mapSampleStatusFromFhir(doc.status),
      status: doc.status,
      storageLocation: {
        boxId: doc.storageSnapshot?.boxId || null,
        position: doc.storageSnapshot?.position || null
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  mapConsentFhirToLegacy(doc) {
    if (!doc) return null;
    return {
      _id: doc.semanticPointers?.mongoConsentId || doc._id,
      patientId: doc.patientId,
      templateId: doc.templateId,
      status: this.mapConsentStatusFromFhir(doc.status),
      signedAt: doc.dateTime,
      revokedAt: doc.revokedAt || null,
      responses: doc.responses || {},
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  async getPatientFhirFirst(db, patientID) {
    if (!await this.canReadCollection(db, 'patients_fhir')) return null;
    if (!(typeof patientID === 'string' && /^\d{8}$/.test(patientID))) return null;

    try {
      const patient = await db.collection('patients_fhir').findOne({ patientID });
      return this.mapPatientFhirToLegacy(patient);
    } catch (error) {
      return null;
    }
  }

  async listPatientsFhirFirst(db, filters = {}) {
    if (!await this.canReadCollection(db, 'patients_fhir')) return null;

    const query = {};
    if (filters.patientName) {
      query['name.text'] = { $regex: filters.patientName, $options: 'i' };
    }
    if (filters.clinicalUnit) {
      query.clinicalUnit = filters.clinicalUnit;
    }

    const limit = filters.limit || 50;
    const skip = filters.skip || 0;

    const docs = await db.collection('patients_fhir').find(query).limit(limit).skip(skip).toArray();
    const total = await db.collection('patients_fhir').countDocuments(query);

    return {
      patients: docs.map((doc) => this.mapPatientFhirToLegacy(doc)),
      total,
      limit,
      skip
    };
  }

  async searchPatientsFhirFirst(db, searchTerm) {
    if (!await this.canReadCollection(db, 'patients_fhir')) return null;

    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
      return { patients: [], total: 0 };
    }

    const term = searchTerm.trim();
    const query = { $or: [] };

    if (/^\d{8}$/.test(term)) {
      query.$or.push({ patientID: term });
    }

    query.$or.push({ recordNumber: { $regex: term, $options: 'i' } });
    query.$or.push({ clinicalUnit: { $regex: term, $options: 'i' } });
    query.$or.push({ unitAcronym: { $regex: term, $options: 'i' } });
    query.$or.push({ 'clinicalProfile.icdCode': { $regex: term, $options: 'i' } });
    query.$or.push({ 'clinicalProfile.diagnosticHypothesis': { $regex: term, $options: 'i' } });
    query.$or.push({ 'clinicalProfile.geneticVariant': { $regex: term, $options: 'i' } });

    const docs = await db.collection('patients_fhir').find(query).limit(50).toArray();
    const total = await db.collection('patients_fhir').countDocuments(query);

    return {
      patients: docs.map((doc) => this.mapPatientFhirToLegacy(doc)),
      total
    };
  }

  async getSampleFhirFirst(db, sampleID) {
    if (!await this.canReadCollection(db, 'samples_fhir')) return null;
    const sampleIDStr = sampleID?.toString ? sampleID.toString() : String(sampleID);

    try {
      const sample = await db.collection('samples_fhir').findOne({
        $or: [
          { 'semanticPointers.mongoSampleId': sampleIDStr },
          { sampleID: sampleIDStr }
        ]
      });
      return this.mapSampleFhirToLegacy(sample);
    } catch (error) {
      return null;
    }
  }

  async getSampleByBarcodeFhirFirst(db, barcode) {
    if (!await this.canReadCollection(db, 'samples_fhir')) return null;

    const barcodeStr = String(barcode || '').trim();
    if (!barcodeStr) return null;

    try {
      let sample = await db.collection('samples_fhir').findOne({
        $or: [
          { barcode: barcodeStr },
          { sampleID: barcodeStr }
        ]
      });

      if (!sample) {
        const barcodeUpper = barcodeStr.toUpperCase();
        sample = await db.collection('samples_fhir').findOne({
          $or: [
            { barcode: barcodeUpper },
            { sampleID: barcodeUpper },
            { barcode: barcodeStr },
            { sampleID: barcodeStr }
          ]
        });
      }

      if (!sample) {
        const escapedBarcode = barcodeStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = new RegExp(`^${escapedBarcode}$`, 'i');
        sample = await db.collection('samples_fhir').findOne({
          $or: [
            { barcode: { $regex: regexPattern } },
            { sampleID: { $regex: regexPattern } }
          ]
        });
      }

      return this.mapSampleFhirToLegacy(sample);
    } catch (error) {
      return null;
    }
  }

  async listSamplesFhirFirst(db, filters = {}) {
    if (!await this.canReadCollection(db, 'samples_fhir')) return null;
    const query = {};

    if (filters.patientID) {
      query.patientID = filters.patientID;
    }
    if (filters.currentStatus) {
      query.status = this.mapSampleStatusToFhir(filters.currentStatus);
    }
    if (filters.sampleType) {
      query['type.text'] = filters.sampleType;
    }

    const limit = filters.limit || 50;
    const skip = filters.skip || 0;

    const docs = await db.collection('samples_fhir').find(query).limit(limit).skip(skip).toArray();
    const total = await db.collection('samples_fhir').countDocuments(query);

    return {
      samples: docs.map((doc) => this.mapSampleFhirToLegacy(doc)),
      total,
      limit,
      skip
    };
  }

  async getPatientConsentFhirFirst(db, patientId) {
    if (!await this.canReadCollection(db, 'consents_fhir')) return null;

    try {
      const consent = await db.collection('consents_fhir')
        .find({ patientId })
        .sort({ dateTime: -1, createdAt: -1 })
        .limit(1)
        .toArray();
      return this.mapConsentFhirToLegacy(consent[0] || null);
    } catch (error) {
      return null;
    }
  }

  validateAndSerialize(Model, payload) {
    const doc = new Model(payload);
    const validationError = doc.validateSync();
    if (validationError) {
      throw validationError;
    }
    const serialized = doc.toObject({ depopulate: true, versionKey: false });
    delete serialized._id;
    return serialized;
  }

  buildPatientFhirPayload(patient) {
    const patientName = String(patient?.patientName || '').trim();
    const names = patientName.split(/\s+/).filter(Boolean);
    const family = names.length > 1 ? names[names.length - 1] : patientName;
    const given = names.length > 1 ? names.slice(0, -1) : [patientName || 'Paciente'];

    return {
      resourceType: 'Patient',
      identifier: [
        {
          system: 'https://bioavanced.local/patient-id',
          value: String(patient.patientID)
        }
      ],
      active: patient?.status !== 'INACTIVE',
      name: [
        {
          use: 'official',
          text: patientName,
          family,
          given
        }
      ],
      telecom: [],
      gender: this.mapSexToFhirGender(patient.sex),
      birthDate: patient.birthDate ? new Date(patient.birthDate) : new Date('1970-01-01T00:00:00.000Z'),
      address: [],
      patientID: String(patient.patientID),
      recordNumber: patient?.recordNumber !== undefined && patient?.recordNumber !== null ? String(patient.recordNumber) : null,
      unitAcronym: patient?.unitAcronym || null,
      clinicalUnit: patient?.clinicalUnit || null,
      clinicalProfile: {
        diagnosticHypothesis: patient?.diagnosticHypothesis || null,
        icdCode: patient?.icdCode || null,
        hypertension: Boolean(patient?.hypertension),
        obesity: Boolean(patient?.obesity),
        diabetesType1: Boolean(patient?.diabetesType1),
        diabetesType2: Boolean(patient?.diabetesType2),
        copd: Boolean(patient?.copd),
        ckd: Boolean(patient?.ckd),
        asthma: Boolean(patient?.asthma),
        smoking: Boolean(patient?.smoking),
        alcoholUse: Boolean(patient?.alcoholUse),
        antibioticUse: Boolean(patient?.antibioticUse),
        antiviralUse: Boolean(patient?.antiviralUse),
        insulinUse: Boolean(patient?.insulinUse),
        geneticVariant: patient?.geneticVariant || null,
        alphaGal: patient?.alphaGal ?? null,
        lysoGb3: patient?.lysoGb3 ?? null
      }
    };
  }

  buildSampleFhirPayload(sample) {
    const sampleId = sample?.sampleID || sample?._id?.toString();
    const barcode = sample?.barcode || sampleId;
    const registerDate = sample?.registrationDate || sample?.registerDate || sample?.createdAt || new Date();

    const samplePointer = buildNeo4jSemanticPointer({
      mongoId: String(sample._id),
      collection: 'samples_fhir'
    });

    const patientPointer = buildNeo4jSemanticPointer({
      mongoId: String(sample.patientID),
      collection: 'patients_fhir'
    });

    const normalizedQuality = Number.isFinite(Number(sample?.quality)) ? Number(sample.quality) : 0;
    const normalizedQuantity = Number.isFinite(Number(sample?.quantity)) ? Number(sample.quantity) : 0;

    return {
      resourceType: 'Specimen',
      identifier: [
        {
          system: 'https://bioavanced.local/specimen-id',
          value: String(sampleId)
        }
      ],
      status: this.mapSampleStatusToFhir(sample?.currentStatus || sample?.status),
      type: {
        coding: [
          {
            system: 'https://bioavanced.local/miabis/sample-type',
            code: String(sample.sampleType),
            display: String(sample.sampleType)
          }
        ],
        text: String(sample.sampleType)
      },
      subject: {
        reference: `Patient/${sample.patientID}`,
        type: 'Patient',
        identifier: {
          system: 'https://bioavanced.local/patient-id',
          value: String(sample.patientID)
        }
      },
      receivedTime: new Date(registerDate),
      collection: {
        collectedDateTime: new Date(registerDate)
      },
      sampleID: sample?.sampleID || null,
      barcode: String(barcode),
      patientID: String(sample.patientID),
      sampleOrigin: String(sample.sampleOrigin),
      extractionProtocol: String(sample.extractionProtocol),
      linkedProject: String(sample.linkedProject),
      quality: normalizedQuality,
      quantity: {
        value: normalizedQuantity,
        unit: String(sample.unit || 'µL'),
        code: String(sample.unit || 'uL')
      },
      semanticPointers: {
        mongoSampleId: samplePointer.id,
        mongoPatientId: patientPointer.id,
        neo4jSamplePointer: samplePointer.pointer,
        lineageManagedInNeo4j: true
      },
      storageSnapshot: {
        boxId: sample?.storageLocation?.boxId ? String(sample.storageLocation.boxId) : null,
        position: sample?.storageLocation?.position || null
      }
    };
  }

  buildConsentFhirPayload(consent) {
    const isActive = String(consent?.status || '').toUpperCase() === 'ACTIVE';
    const signedAt = consent?.signedAt || consent?.createdAt || new Date();

    const consentPointer = buildNeo4jSemanticPointer({
      mongoId: String(consent._id),
      collection: 'consents_fhir'
    });

    const patientPointer = buildNeo4jSemanticPointer({
      mongoId: String(consent.patientId),
      collection: 'patients_fhir'
    });

    return {
      resourceType: 'Consent',
      status: this.mapConsentStatusToFhir(consent.status),
      scope: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/consentscope',
            code: 'research',
            display: 'Research'
          }
        ]
      },
      category: [
        {
          coding: [
            {
              system: 'http://loinc.org',
              code: '59284-0',
              display: 'Consent Document'
            }
          ]
        }
      ],
      patient: {
        reference: `Patient/${consent.patientId}`,
        identifier: {
          value: String(consent.patientId)
        }
      },
      dateTime: new Date(signedAt),
      performer: [],
      policyRule: {
        coding: [
          {
            system: 'https://bioavanced.local/policy',
            code: 'dynamic-consent',
            display: 'Dynamic Consent'
          }
        ]
      },
      provision: {
        type: isActive ? 'permit' : 'deny',
        period: {
          start: new Date(signedAt),
          end: consent?.revokedAt ? new Date(consent.revokedAt) : null
        },
        action: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/consentaction',
            code: 'access',
            display: 'Access'
          }
        ],
        securityLabel: []
      },
      patientId: String(consent.patientId),
      templateId: String(consent.templateId),
      revokedAt: consent?.revokedAt ? new Date(consent.revokedAt) : null,
      responses: consent?.responses || {},
      semanticPointers: {
        mongoConsentId: consentPointer.id,
        mongoPatientId: patientPointer.id,
        neo4jConsentPointer: consentPointer.pointer
      }
    };
  }

  async upsertPatientFromLegacy(db, patient) {
    try {
      const payload = this.buildPatientFhirPayload(patient);
      const document = this.validateAndSerialize(PatientFHIR, payload);

      await db.collection('patients_fhir').updateOne(
        { patientID: document.patientID },
        { $set: { ...document, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    } catch (error) {
      logger.warn('[FHIR_SYNC] Falha ao sincronizar PatientFHIR:', error.message || error);
    }
  }

  async upsertSampleFromLegacy(db, sample) {
    try {
      const payload = this.buildSampleFhirPayload(sample);
      const document = this.validateAndSerialize(SampleFHIR, payload);

      await db.collection('samples_fhir').updateOne(
        { 'semanticPointers.mongoSampleId': document.semanticPointers.mongoSampleId },
        { $set: { ...document, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    } catch (error) {
      logger.warn('[FHIR_SYNC] Falha ao sincronizar SampleFHIR:', error.message || error);
    }
  }

  async upsertConsentFromLegacy(db, consent) {
    try {
      const payload = this.buildConsentFhirPayload(consent);
      const document = this.validateAndSerialize(ConsentFHIR, payload);

      await db.collection('consents_fhir').updateOne(
        { 'semanticPointers.mongoConsentId': document.semanticPointers.mongoConsentId },
        { $set: { ...document, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    } catch (error) {
      logger.warn('[FHIR_SYNC] Falha ao sincronizar ConsentFHIR:', error.message || error);
    }
  }

  async syncAllLegacyData(db, options = {}) {
    const limit = Number(options.limit || 0);
    const summary = {
      patients: 0,
      samples: 0,
      consents: 0
    };

    const patientSourceName = await resolveSourceCollectionName(db, 'patients');
    const patientsCollection = db.collection(patientSourceName);
    const patientsCursor = patientsCollection.find({}, { projection: { _id: 1, patientID: 1, patientName: 1, sex: 1, birthDate: 1, recordNumber: 1, unitAcronym: 1, clinicalUnit: 1, diagnosticHypothesis: 1, icdCode: 1, hypertension: 1, obesity: 1, diabetesType1: 1, diabetesType2: 1, copd: 1, ckd: 1, asthma: 1, smoking: 1, alcoholUse: 1, antibioticUse: 1, antiviralUse: 1, insulinUse: 1, geneticVariant: 1, alphaGal: 1, lysoGb3: 1, status: 1 } });
    if (limit > 0) patientsCursor.limit(limit);
    while (await patientsCursor.hasNext()) {
      const patient = await patientsCursor.next();
      await this.upsertPatientFromLegacy(db, patient);
      summary.patients += 1;
    }

    const sampleSourceName = await resolveSourceCollectionName(db, 'samples');
    const samplesCollection = db.collection(sampleSourceName);
    const samplesCursor = samplesCollection.find({}, { projection: { _id: 1, sampleID: 1, patientID: 1, sampleType: 1, sampleOrigin: 1, extractionProtocol: 1, linkedProject: 1, quality: 1, quantity: 1, unit: 1, barcode: 1, registrationDate: 1, registerDate: 1, currentStatus: 1, status: 1, storageLocation: 1 } });
    if (limit > 0) samplesCursor.limit(limit);
    while (await samplesCursor.hasNext()) {
      const sample = await samplesCursor.next();
      await this.upsertSampleFromLegacy(db, sample);
      summary.samples += 1;
    }

    const consentSourceName = await resolveSourceCollectionName(db, 'consents');
    const consentsCollection = db.collection(consentSourceName);
    const consentsCursor = consentsCollection.find({}, { projection: { _id: 1, patientId: 1, templateId: 1, status: 1, signedAt: 1, revokedAt: 1, responses: 1, createdAt: 1 } });
    if (limit > 0) consentsCursor.limit(limit);
    while (await consentsCursor.hasNext()) {
      const consent = await consentsCursor.next();
      await this.upsertConsentFromLegacy(db, consent);
      summary.consents += 1;
    }

    return summary;
  }
}

module.exports = new FhirSyncService();
