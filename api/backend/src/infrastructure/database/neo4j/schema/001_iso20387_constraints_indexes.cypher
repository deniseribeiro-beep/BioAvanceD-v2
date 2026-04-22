// =============================================
// BioAvanceD - Neo4j Schema (ISO 20387 + FHIR)
// =============================================

CREATE CONSTRAINT donor_mongo_patient_id_unique IF NOT EXISTS
FOR (d:Donor)
REQUIRE d.mongoPatientId IS UNIQUE;

CREATE CONSTRAINT sample_mongo_sample_id_unique IF NOT EXISTS
FOR (s:Sample)
REQUIRE s.mongoSampleId IS UNIQUE;

CREATE CONSTRAINT aliquot_mongo_sample_id_unique IF NOT EXISTS
FOR (a:Aliquot)
REQUIRE a.mongoSampleId IS UNIQUE;

CREATE CONSTRAINT consent_mongo_consent_id_unique IF NOT EXISTS
FOR (c:EthicalConsent)
REQUIRE c.mongoConsentId IS UNIQUE;

CREATE CONSTRAINT consent_pointer_id_unique IF NOT EXISTS
FOR (c:EthicalConsent)
REQUIRE c.id IS UNIQUE;

CREATE INDEX donor_patient_id_idx IF NOT EXISTS
FOR (d:Donor)
ON (d.patientId);

CREATE INDEX sample_barcode_idx IF NOT EXISTS
FOR (s:Sample)
ON (s.barcode);

CREATE INDEX aliquot_barcode_idx IF NOT EXISTS
FOR (a:Aliquot)
ON (a.barcode);

CREATE INDEX consent_status_idx IF NOT EXISTS
FOR (c:EthicalConsent)
ON (c.status);

CREATE INDEX custody_event_happened_at_idx IF NOT EXISTS
FOR (e:CustodyEvent)
ON (e.happenedAt);
