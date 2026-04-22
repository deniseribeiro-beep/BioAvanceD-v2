// backend/src/infrastructure/database/neo4j/diagnosis_phenotype.cypher
// Cypher para criar topologia: (Paciente)-[:HAS_DIAGNOSIS]->(Doença)-[:PRESENTS_PHENOTYPE]->(Fenótipo_HPO)
// Parâmetros: $patientId, $diagnoses (array)

WITH $patientId AS patientId, $diagnoses AS diagnoses
MATCH (p:Patient {patientID: patientId})
UNWIND diagnoses AS diag
  MERGE (d:Disease {cid: diag.disease.cid, orpha: diag.disease.orpha, omim: diag.disease.omim, name: diag.disease.name})
  MERGE (p)-[:HAS_DIAGNOSIS {isMain: diag.isMainDiagnosis}]->(d)
  FOREACH (pheno IN diag.phenotypes |
    MERGE (ph:Phenotype {hpoId: pheno.hpoId, label: pheno.label})
    MERGE (d)-[:PRESENTS_PHENOTYPE]->(ph)
  )
