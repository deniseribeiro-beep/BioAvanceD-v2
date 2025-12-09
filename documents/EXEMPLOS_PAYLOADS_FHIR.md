# Exemplos de Payloads FHIR R4 - BioAdvanceD

Este documento contém exemplos de recursos FHIR R4 gerados pelo sistema BioAdvanceD.

## FHIR.Patient

```json
{
  "resourceType": "Patient",
  "id": "12345678",
  "identifier": [
    {
      "system": "http://bioavanced.local/patient-id",
      "value": "12345678"
    },
    {
      "system": "http://bioavanced.local/record-number",
      "value": "2024001"
    }
  ],
  "name": [
    {
      "use": "official",
      "family": "Silva",
      "given": ["João", "Santos"]
    }
  ],
  "gender": "male",
  "birthDate": "1985-03-15",
  "extension": [
    {
      "url": "http://bioavanced.local/StructureDefinition/patient-weight",
      "valueQuantity": {
        "value": 75.5,
        "unit": "kg",
        "system": "http://unitsofmeasure.org",
        "code": "kg"
      }
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/patient-height",
      "valueQuantity": {
        "value": 175,
        "unit": "cm",
        "system": "http://unitsofmeasure.org",
        "code": "cm"
      }
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/clinical-unit",
      "valueString": "Hospital Universitário"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/conditions",
      "valueString": "Hypertension, Diabetes Type 2"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/icd-code",
      "valueString": "E75.21"
    }
  ]
}
```

## FHIR.Specimen

```json
{
  "resourceType": "Specimen",
  "id": "sample-001",
  "identifier": [
    {
      "system": "http://bioavanced.local/sample-id",
      "value": "sample-001"
    },
    {
      "system": "http://bioavanced.local/barcode",
      "value": "BR-2024-001"
    }
  ],
  "status": "available",
  "type": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "119297000",
        "display": "Sangue"
      }
    ]
  },
  "subject": {
    "reference": "Patient/12345678"
  },
  "receivedTime": "2024-03-15T10:30:00Z",
  "quantity": {
    "value": 500.5,
    "unit": "µL",
    "system": "http://unitsofmeasure.org",
    "code": "uL"
  },
  "extension": [
    {
      "url": "http://bioavanced.local/StructureDefinition/sample-origin",
      "valueString": "Coleta"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/extraction-protocol",
      "valueString": "QIAGEN"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/sample-quality",
      "valueCode": "suitable"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/location-id",
      "valueInteger": 1
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/linked-project",
      "valueString": "Projeto Genoma"
    }
  ]
}
```

## FHIR.Observation (Result)

```json
{
  "resourceType": "Observation",
  "id": "result-001",
  "identifier": [
    {
      "system": "http://bioavanced.local/result-id",
      "value": "result-001"
    }
  ],
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "laboratory",
          "display": "Laboratory"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "UNKNOWN",
        "display": "Unknown Test"
      }
    ]
  },
  "subject": {
    "reference": "Specimen/sample-001"
  },
  "effectiveDateTime": "2024-03-15T14:00:00Z",
  "valueString": "Positive",
  "extension": [
    {
      "url": "http://bioavanced.local/StructureDefinition/result-file",
      "valueString": "/uploads/results/result-001.csv"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/result-file-type",
      "valueString": "CSV"
    }
  ]
}
```

## FHIR.DiagnosticReport (Result)

```json
{
  "resourceType": "DiagnosticReport",
  "id": "dr-result-001",
  "identifier": [
    {
      "system": "http://bioavanced.local/diagnostic-report-id",
      "value": "result-001"
    }
  ],
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
          "code": "LAB",
          "display": "Laboratory"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "UNKNOWN",
        "display": "Unknown Test"
      }
    ]
  },
  "subject": {
    "reference": "Specimen/sample-001"
  },
  "effectiveDateTime": "2024-03-15T14:00:00Z",
  "result": [
    {
      "reference": "Observation/result-001"
    }
  ]
}
```

## FHIR.Device (Temperature)

```json
{
  "resourceType": "Device",
  "id": "device-TEMP-001",
  "identifier": [
    {
      "system": "http://bioavanced.local/sensor-id",
      "value": "TEMP-001"
    }
  ],
  "status": "active",
  "type": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "706689003",
        "display": "Temperature sensor"
      }
    ]
  },
  "extension": [
    {
      "url": "http://bioavanced.local/StructureDefinition/location-id",
      "valueInteger": 1
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/facility",
      "valueString": "Lab A"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/zone",
      "valueString": "Freezer 1"
    }
  ]
}
```

## FHIR.Observation (Temperature)

```json
{
  "resourceType": "Observation",
  "id": "temp-20240315143000",
  "identifier": [
    {
      "system": "http://bioavanced.local/temperature-id",
      "value": "temp-20240315143000"
    }
  ],
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8310-5",
        "display": "Body temperature"
      }
    ]
  },
  "device": {
    "reference": "Device/device-TEMP-001"
  },
  "effectiveDateTime": "2024-03-15T14:30:00Z",
  "valueQuantity": {
    "value": 4.5,
    "unit": "°C",
    "system": "http://unitsofmeasure.org",
    "code": "[degC]"
  },
  "extension": [
    {
      "url": "http://bioavanced.local/StructureDefinition/signal-quality",
      "valueString": "excellent"
    },
    {
      "url": "http://bioavanced.local/StructureDefinition/battery-level",
      "valueInteger": 85
    }
  ]
}
```

## Bundle FHIR (Exemplo Completo)

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "12345678",
        ...
      }
    },
    {
      "resource": {
        "resourceType": "Specimen",
        "id": "sample-001",
        "subject": {
          "reference": "Patient/12345678"
        },
        ...
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "id": "result-001",
        "subject": {
          "reference": "Specimen/sample-001"
        },
        ...
      }
    }
  ]
}
```

## Validação

Todos os recursos FHIR são validados antes da persistência usando:

```javascript
fhirService.validateFHIRResource(resource);
```

A validação verifica:
- Presença de `resourceType`
- Presença de `id`
- Estrutura básica do recurso

## Busca por Identifier

Recursos podem ser buscados por identifier:

```javascript
const patient = await fhirService.findResourceByIdentifier(
  db,
  'pacientes',
  'http://bioavanced.local/patient-id',
  '12345678'
);
```

Isso permite implementar update quando o identifier já existe, conforme especificado na auditoria.

