// ======================================================
// BioAvanceD - Dynamic Consent + Lineage Validation
// ======================================================

// 1) Upsert de Donor (ponteiro semântico para Mongo Patient._id)
MERGE (d:Donor {mongoPatientId: $mongoPatientId})
ON CREATE SET d.createdAt = datetime(), d.patientId = $patientId
SET d.updatedAt = datetime(), d.patientId = coalesce($patientId, d.patientId);

// 2) Upsert de Consentimento e vínculo com donor
MERGE (c:EthicalConsent {mongoConsentId: $mongoConsentId})
ON CREATE SET c.createdAt = datetime(), c.id = $consentPointerId
SET c.updatedAt = datetime(),
    c.id = coalesce($consentPointerId, c.id),
    c.status = $status,
    c.validFrom = datetime($validFrom),
    c.validTo = CASE WHEN $validTo IS NULL THEN null ELSE datetime($validTo) END,
    c.scope = coalesce($scope, 'research');

MATCH (d:Donor {mongoPatientId: $mongoPatientId})
MATCH (c:EthicalConsent {mongoConsentId: $mongoConsentId})
MERGE (d)-[:HAS_CONSENT]->(c);

// 3) Criação de amostra raiz (não árvore no Mongo)
MATCH (d:Donor {mongoPatientId: $mongoPatientId})
MERGE (s:Sample {mongoSampleId: $mongoSampleId})
ON CREATE SET s.createdAt = datetime(), s.barcode = $barcode
SET s.updatedAt = datetime(), s.barcode = coalesce($barcode, s.barcode)
MERGE (s)-[:COLLECTED_FROM]->(d);

// 4) Derivação de alíquota com vínculo de linhagem
MATCH (parent:Sample {mongoSampleId: $parentMongoSampleId})
MERGE (child:Aliquot {mongoSampleId: $childMongoSampleId})
ON CREATE SET child.createdAt = datetime(), child.barcode = $childBarcode
SET child.updatedAt = datetime(), child.barcode = coalesce($childBarcode, child.barcode)
MERGE (child)-[:DERIVED_FROM]->(parent);

// 5) Validação de consentimento dinâmico da alíquota até o donor raiz
MATCH path = (aliquot:Aliquot {mongoSampleId: $childMongoSampleId})-[:DERIVED_FROM*0..]->(root:Sample)-[:COLLECTED_FROM]->(donor:Donor)
OPTIONAL MATCH (donor)-[:HAS_CONSENT]->(consent:EthicalConsent)
WHERE consent.status = 'ACTIVE'
  AND consent.validFrom <= datetime()
  AND (consent.validTo IS NULL OR consent.validTo >= datetime())
RETURN
  aliquot.mongoSampleId AS aliquotMongoId,
  donor.mongoPatientId AS donorMongoPatientId,
  CASE WHEN consent IS NULL THEN false ELSE true END AS hasActiveConsent,
  length(path) AS lineageDepth,
  consent.id AS activeConsentPointer;

// 6) Bloqueio transacional (chamar antes de operação crítica)
MATCH path = (aliquot:Aliquot {mongoSampleId: $childMongoSampleId})-[:DERIVED_FROM*0..]->(root:Sample)-[:COLLECTED_FROM]->(donor:Donor)
OPTIONAL MATCH (donor)-[:HAS_CONSENT]->(consent:EthicalConsent)
WHERE consent.status = 'ACTIVE'
  AND consent.validFrom <= datetime()
  AND (consent.validTo IS NULL OR consent.validTo >= datetime())
WITH count(consent) AS activeConsents
CALL apoc.util.validate(activeConsents = 0, 'ISO20387_CONSENT_REQUIRED', [])
RETURN true AS consentValidated;
