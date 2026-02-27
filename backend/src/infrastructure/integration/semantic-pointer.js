function buildNeo4jSemanticPointer({ mongoId, collection }) {
  if (!mongoId || !collection) {
    throw new Error('mongoId e collection são obrigatórios para ponteiro semântico');
  }

  const id = String(mongoId);
  return {
    id,
    pointer: `mongo://${collection}/${id}`,
    collection,
    sourceDb: 'mongodb',
    sourceCollection: collection
  };
}

function mapSampleToNeo4jProps(sampleDoc) {
  if (!sampleDoc?._id) {
    throw new Error('sampleDoc._id é obrigatório');
  }

  const samplePointer = buildNeo4jSemanticPointer({
    mongoId: sampleDoc._id,
    collection: 'samples_fhir'
  });

  const patientPointer = buildNeo4jSemanticPointer({
    mongoId: sampleDoc?.semanticPointers?.mongoPatientId || sampleDoc.patientID,
    collection: 'patients_fhir'
  });

  return {
    mongoSampleId: samplePointer.id,
    sampleSemanticPointer: samplePointer.pointer,
    mongoPatientId: patientPointer.id,
    patientSemanticPointer: patientPointer.pointer,
    barcode: sampleDoc?.identifier?.[0]?.value || sampleDoc?.sampleID || null
  };
}

function buildUpsertSampleCypherParams(sampleDoc) {
  const props = mapSampleToNeo4jProps(sampleDoc);

  return {
    cypher: `
      MERGE (s:Sample {mongoSampleId: $mongoSampleId})
      ON CREATE SET s.createdAt = datetime(), s.source = 'BioAvanceD'
      SET s.updatedAt = datetime(),
          s.semanticPointer = $sampleSemanticPointer,
          s.barcode = coalesce($barcode, s.barcode)

      MERGE (d:Donor {mongoPatientId: $mongoPatientId})
      ON CREATE SET d.createdAt = datetime(), d.source = 'BioAvanceD'
      SET d.updatedAt = datetime(),
          d.semanticPointer = $patientSemanticPointer

      MERGE (s)-[:COLLECTED_FROM]->(d)
      RETURN s.mongoSampleId AS samplePointer, d.mongoPatientId AS donorPointer
    `,
    params: props
  };
}

module.exports = {
  buildNeo4jSemanticPointer,
  mapSampleToNeo4jProps,
  buildUpsertSampleCypherParams
};
