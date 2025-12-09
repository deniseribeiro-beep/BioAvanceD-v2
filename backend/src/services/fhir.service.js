const logger = require('../utils/logger');

/**
 * Serviço de Transformação HL7 FHIR R4
 * Converte dados do BioAdvanceD para recursos FHIR R4
 */

class FHIRService {
  /**
   * Converte Patient para FHIR.Patient
   */
  patientToFHIR(patient) {
    try {
      const fhirPatient = {
        resourceType: 'Patient',
        id: patient.patientID?.toString() || patient._id?.toString(),
        identifier: [
          {
            system: 'http://bioavanced.local/patient-id',
            value: patient.patientID?.toString() || patient._id?.toString(),
          },
        ],
        name: [
          {
            use: 'official',
            family: this.extractFamilyName(patient.patientName),
            given: this.extractGivenNames(patient.patientName),
          },
        ],
        gender: this.mapSexToFHIR(patient.sex),
        birthDate: this.formatDate(patient.birthDate),
        extension: [],
      };

      // Adiciona extensões para dados adicionais
      if (patient.weight) {
        fhirPatient.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/patient-weight',
          valueQuantity: {
            value: patient.weight,
            unit: 'kg',
            system: 'http://unitsofmeasure.org',
            code: 'kg',
          },
        });
      }

      if (patient.heightCm) {
        fhirPatient.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/patient-height',
          valueQuantity: {
            value: patient.heightCm,
            unit: 'cm',
            system: 'http://unitsofmeasure.org',
            code: 'cm',
          },
        });
      }

      if (patient.recordNumber) {
        fhirPatient.identifier.push({
          system: 'http://bioavanced.local/record-number',
          value: patient.recordNumber.toString(),
        });
      }

      if (patient.clinicalUnit) {
        fhirPatient.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/clinical-unit',
          valueString: patient.clinicalUnit,
        });
      }

      // Adiciona condições (comorbidades)
      const conditions = [];
      if (patient.hypertension) conditions.push('Hypertension');
      if (patient.obesity) conditions.push('Obesity');
      if (patient.diabetesType1) conditions.push('Diabetes Type 1');
      if (patient.diabetesType2) conditions.push('Diabetes Type 2');
      if (patient.copd) conditions.push('COPD');
      if (patient.ckd) conditions.push('CKD');
      if (patient.asthma) conditions.push('Asthma');

      if (conditions.length > 0) {
        fhirPatient.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/conditions',
          valueString: conditions.join(', '),
        });
      }

      if (patient.icdCode) {
        fhirPatient.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/icd-code',
          valueString: patient.icdCode,
        });
      }

      return fhirPatient;
    } catch (error) {
      logger.error('Erro ao converter Patient para FHIR:', error);
      throw error;
    }
  }

  /**
   * Converte Sample para FHIR.Specimen
   */
  sampleToFHIR(sample, patientReference = null) {
    try {
      const fhirSpecimen = {
        resourceType: 'Specimen',
        id: sample.sampleID?.toString() || sample._id?.toString(),
        identifier: [
          {
            system: 'http://bioavanced.local/sample-id',
            value: sample.sampleID?.toString() || sample._id?.toString(),
          },
        ],
        status: this.mapSampleStatusToFHIR(sample.currentStatus),
        type: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: this.mapSampleTypeToSNOMED(sample.sampleType),
              display: sample.sampleType,
            },
          ],
        },
        subject: patientReference || {
          reference: `Patient/${sample.patientID}`,
        },
        receivedTime: this.formatDateTime(sample.registrationDate || sample.registerDate),
        extension: [],
      };

      if (sample.barcode) {
        fhirSpecimen.identifier.push({
          system: 'http://bioavanced.local/barcode',
          value: sample.barcode.toString(),
        });
      }

      if (sample.sampleOrigin) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/sample-origin',
          valueString: sample.sampleOrigin,
        });
      }

      if (sample.extractionProtocol) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/extraction-protocol',
          valueString: sample.extractionProtocol,
        });
      }

      if (sample.quantity) {
        fhirSpecimen.quantity = {
          value: sample.quantity,
          unit: 'µL',
          system: 'http://unitsofmeasure.org',
          code: 'uL',
        };
      }

      if (sample.quality !== undefined && sample.quality !== null) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/sample-quality',
          valueCode: this.mapQualityToFHIR(sample.quality),
        });
      }

      if (sample.locationID) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/location-id',
          valueInteger: sample.locationID,
        });
      }

      if (sample.linkedProject) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/linked-project',
          valueString: sample.linkedProject,
        });
      }

      // HL7 FHIR - Campos obrigatórios adicionais
      if (sample.accessionNumber) {
        fhirSpecimen.identifier.push({
          system: 'http://bioavanced.local/accession-number',
          value: sample.accessionNumber.toString(),
        });
      }

      if (sample.orderNumber) {
        fhirSpecimen.request = [{
          reference: `ServiceRequest/${sample.orderNumber}`,
        }];
      }

      if (sample.receivedTime) {
        fhirSpecimen.receivedTime = this.formatDateTime(sample.receivedTime);
      }

      if (sample.processingStatus) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/processing-status',
          valueCode: sample.processingStatus,
        });
      }

      if (sample.protocolApplied) {
        fhirSpecimen.processing = [{
          description: sample.protocolApplied,
          time: this.formatDateTime(sample.receivedTime || sample.registrationDate),
        }];
      }

      if (sample.specimenCollection) {
        fhirSpecimen.collection = sample.specimenCollection;
      }

      if (sample.linkedFiles && Array.isArray(sample.linkedFiles) && sample.linkedFiles.length > 0) {
        fhirSpecimen.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/linked-files',
          valueReference: sample.linkedFiles.map(file => ({
            reference: `DocumentReference/${file}`,
          })),
        });
      }

      return fhirSpecimen;
    } catch (error) {
      logger.error('Erro ao converter Sample para FHIR:', error);
      throw error;
    }
  }

  /**
   * Converte Result para FHIR.Observation e/ou FHIR.DiagnosticReport
   */
  resultToFHIR(result, sampleReference = null) {
    try {
      const fhirObservation = {
        resourceType: 'Observation',
        id: result.resultID?.toString() || result._id?.toString(),
        identifier: [
          {
            system: 'http://bioavanced.local/result-id',
            value: result.resultID?.toString() || result._id?.toString(),
          },
        ],
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'laboratory',
                display: 'Laboratory',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: result.testCode || 'UNKNOWN',
              display: result.testName || 'Unknown Test',
            },
          ],
        },
        subject: sampleReference || {
          reference: `Specimen/${result.sampleID}`,
        },
        effectiveDateTime: this.formatDateTime(result.testDate || result.createdAt),
        valueString: result.resultValue || null,
        extension: [],
      };

      if (result.filePath) {
        fhirObservation.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/result-file',
          valueString: result.filePath,
        });
      }

      if (result.fileType) {
        fhirObservation.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/result-file-type',
          valueString: result.fileType,
        });
      }

      // Cria DiagnosticReport se necessário
      const fhirDiagnosticReport = {
        resourceType: 'DiagnosticReport',
        id: `dr-${result.resultID || result._id}`,
        identifier: [
          {
            system: 'http://bioavanced.local/diagnostic-report-id',
            value: result.resultID?.toString() || result._id?.toString(),
          },
        ],
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
                code: 'LAB',
                display: 'Laboratory',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: result.testCode || 'UNKNOWN',
              display: result.testName || 'Unknown Test',
            },
          ],
        },
        subject: sampleReference || {
          reference: `Specimen/${result.sampleID}`,
        },
        effectiveDateTime: this.formatDateTime(result.testDate || result.createdAt),
        result: [
          {
            reference: `Observation/${fhirObservation.id}`,
          },
        ],
      };

      return {
        observation: fhirObservation,
        diagnosticReport: fhirDiagnosticReport,
      };
    } catch (error) {
      logger.error('Erro ao converter Result para FHIR:', error);
      throw error;
    }
  }

  /**
   * Converte Temperature para FHIR.Device + FHIR.Observation
   */
  temperatureToFHIR(temperature) {
    try {
      const fhirDevice = {
        resourceType: 'Device',
        id: `device-${temperature.sensorId}`,
        identifier: [
          {
            system: 'http://bioavanced.local/sensor-id',
            value: temperature.sensorId?.toString(),
          },
        ],
        status: this.mapSensorStatusToFHIR(temperature.sensorStatus),
        type: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: '706689003',
              display: 'Temperature sensor',
            },
          ],
        },
        extension: [],
      };

      if (temperature.locationId) {
        fhirDevice.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/location-id',
          valueInteger: temperature.locationId,
        });
      }

      if (temperature.facility) {
        fhirDevice.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/facility',
          valueString: temperature.facility,
        });
      }

      if (temperature.zone) {
        fhirDevice.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/zone',
          valueString: temperature.zone,
        });
      }

      const fhirObservation = {
        resourceType: 'Observation',
        id: `temp-${temperature._id || temperature.timestamp}`,
        identifier: [
          {
            system: 'http://bioavanced.local/temperature-id',
            value: temperature._id?.toString() || temperature.timestamp?.toString(),
          },
        ],
        status: this.mapReadingStatusToFHIR(temperature.readingStatus),
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8310-5',
              display: 'Body temperature',
            },
          ],
        },
        device: {
          reference: `Device/${fhirDevice.id}`,
        },
        effectiveDateTime: this.formatDateTime(temperature.timestamp),
        valueQuantity: {
          value: temperature.temperatureValue,
          unit: temperature.temperatureUnit || '°C',
          system: 'http://unitsofmeasure.org',
          code: temperature.temperatureUnit === '°F' ? '[degF]' : '[degC]',
        },
        extension: [],
      };

      if (temperature.signalQuality) {
        fhirObservation.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/signal-quality',
          valueString: temperature.signalQuality,
        });
      }

      if (temperature.batteryLevel !== undefined && temperature.batteryLevel !== null) {
        fhirObservation.extension.push({
          url: 'http://bioavanced.local/StructureDefinition/battery-level',
          valueInteger: temperature.batteryLevel,
        });
      }

      return {
        device: fhirDevice,
        observation: fhirObservation,
      };
    } catch (error) {
      logger.error('Erro ao converter Temperature para FHIR:', error);
      throw error;
    }
  }

  /**
   * Valida recurso FHIR
   */
  validateFHIRResource(resource) {
    if (!resource.resourceType) {
      throw new Error('Recurso FHIR deve ter resourceType');
    }

    if (!resource.id) {
      throw new Error('Recurso FHIR deve ter id');
    }

    return true;
  }

  /**
   * Busca recurso por identifier
   */
  async findResourceByIdentifier(db, collection, identifierSystem, identifierValue) {
    try {
      const query = {
        'fhir.identifier': {
          $elemMatch: {
            system: identifierSystem,
            value: identifierValue.toString(),
          },
        },
      };

      return await db.collection(collection).findOne(query);
    } catch (error) {
      logger.error('Erro ao buscar recurso por identifier:', error);
      throw error;
    }
  }

  // Métodos auxiliares

  extractFamilyName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  extractGivenNames(fullName) {
    if (!fullName) return [];
    const parts = fullName.trim().split(/\s+/);
    return parts.slice(0, -1);
  }

  mapSexToFHIR(sex) {
    const mapping = {
      M: 'male',
      F: 'female',
      O: 'other',
    };
    return mapping[sex] || 'unknown';
  }

  mapSampleStatusToFHIR(status) {
    const mapping = {
      Available: 'available',
      Withdrawn: 'unavailable',
      Expired: 'unsatisfactory',
      Destroyed: 'unavailable',
    };
    return mapping[status] || 'available';
  }

  mapSampleTypeToSNOMED(sampleType) {
    // Mapeamento básico - pode ser expandido
    const mapping = {
      Sangue: '119297000',
      Urina: '122575003',
      Saliva: '119361006',
      DNA: '118234003',
      RNA: '118234003',
    };
    return mapping[sampleType] || '118234003'; // Default: Specimen
  }

  mapQualityToFHIR(quality) {
    const mapping = {
      0: 'not-assessed',
      1: 'suitable',
      2: 'not-suitable',
    };
    return mapping[quality] || 'not-assessed';
  }

  mapSensorStatusToFHIR(status) {
    const mapping = {
      normal: 'active',
      error: 'inactive',
      maintenance: 'inactive',
    };
    return mapping[status] || 'unknown';
  }

  mapReadingStatusToFHIR(status) {
    const mapping = {
      valid: 'final',
      invalid: 'cancelled',
      pending: 'preliminary',
    };
    return mapping[status] || 'final';
  }

  formatDate(date) {
    if (!date) return null;
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    if (typeof date === 'string') {
      return date.split('T')[0];
    }
    return null;
  }

  formatDateTime(date) {
    if (!date) return null;
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      return new Date(date).toISOString();
    }
    return null;
  }
}

module.exports = new FHIRService();

