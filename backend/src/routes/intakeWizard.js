// backend/src/routes/intakeWizard.js
const express = require('express');
const router = express.Router();
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

const semanticCodingSchema = {
  type: 'object',
  required: ['system', 'code', 'display'],
  additionalProperties: false,
  properties: {
    system: { type: 'string', minLength: 1 },
    code: { type: 'string', minLength: 1 },
    display: { type: 'string', minLength: 1 },
  },
};

// Schema AJV para intake wizard
const intakeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pseudoId', 'tcleAccepted', 'orpha', 'hpo', 'volume', 'aditivo', 'tempoIsquemia', 'temperatura', 'freezer', 'rack', 'caixa', 'posicao'],
  properties: {
    pseudoId: { type: 'string', minLength: 4 },
    tcleAccepted: { type: 'boolean' },
    orpha: {
      ...semanticCodingSchema,
      properties: {
        ...semanticCodingSchema.properties,
        system: { const: 'http://www.orpha.net' },
      },
    },
    hpo: {
      type: 'array',
      minItems: 1,
      items: {
        ...semanticCodingSchema,
        properties: {
          ...semanticCodingSchema.properties,
          system: { const: 'http://purl.obolibrary.org/obo/hp.owl' },
        },
      },
    },
    volume: { type: 'number', minimum: 0.01 },
    aditivo: { type: 'string', enum: ['EDTA', 'Heparina', 'Outro'] },
    tempoIsquemia: { type: 'number', minimum: 0 },
    temperatura: { type: 'number' },
    freezer: { type: 'string', minLength: 1 },
    rack: { type: 'string', minLength: 1 },
    caixa: { type: 'string', minLength: 1 },
    posicao: { type: 'string', minLength: 1 }
  }
};
const validate = ajv.compile(intakeSchema);

// Quality by Design
function calcularQualidade(tempoIsquemia, temperatura) {
  if (tempoIsquemia <= 30 && temperatura <= 8) return 'Ótima';
  if (tempoIsquemia <= 60 && temperatura <= 20) return 'Subótima';
  return 'Ruim';
}

router.post('/intake-wizard', async (req, res) => {
  const data = req.body;
  const valid = validate(data);
  if (!valid) {
    return res.status(400).json({ error: 'Dados invalidos', details: validate.errors });
  }

  // Contrato estrito: somente coding estruturado (system/code/display), sem texto livre.
  // Calcula status de qualidade
  const qualidade = calcularQualidade(data.tempoIsquemia, data.temperatura);
  // TODO: Persistir no banco (MongoDB/Neo4j)
  res.json({ success: true, qualidade, data });
});

module.exports = router;
