// =============================================
// BioAvanceD - Neo4j Schema Canônico
// =============================================

CREATE CONSTRAINT donor_id_unique IF NOT EXISTS
FOR (d:Donor)
REQUIRE d.id IS UNIQUE;

CREATE CONSTRAINT sample_id_unique IF NOT EXISTS
FOR (s:Sample)
REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT ethical_consent_id_unique IF NOT EXISTS
FOR (c:EthicalConsent)
REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT rare_disease_code_unique IF NOT EXISTS
FOR (d:RareDisease)
REQUIRE d.code IS UNIQUE;

CREATE CONSTRAINT phenotype_code_unique IF NOT EXISTS
FOR (p:Phenotype)
REQUIRE p.code IS UNIQUE;

CREATE CONSTRAINT biomarker_code_unique IF NOT EXISTS
FOR (b:Biomarker)
REQUIRE b.code IS UNIQUE;

CREATE CONSTRAINT biomarker_observation_id_unique IF NOT EXISTS
FOR (o:BiomarkerObservation)
REQUIRE o.id IS UNIQUE;

CREATE CONSTRAINT quality_assessment_id_unique IF NOT EXISTS
FOR (q:QualityAssessment)
REQUIRE q.id IS UNIQUE;

CREATE CONSTRAINT custody_event_id_unique IF NOT EXISTS
FOR (e:CustodyEvent)
REQUIRE e.id IS UNIQUE;

CREATE CONSTRAINT storage_position_id_unique IF NOT EXISTS
FOR (s:StoragePosition)
REQUIRE (s.boxId, s.position) IS UNIQUE;

CREATE CONSTRAINT telemetry_incident_id_unique IF NOT EXISTS
FOR (t:TelemetryIncident)
REQUIRE t.id IS UNIQUE;

CREATE CONSTRAINT research_project_id_unique IF NOT EXISTS
FOR (r:ResearchProject)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT terminology_concept_id_unique IF NOT EXISTS
FOR (tc:TerminologyConcept)
REQUIRE tc.id IS UNIQUE;

CREATE INDEX sample_mongo_sample_id_idx IF NOT EXISTS
FOR (s:Sample)
ON (s.specimenId);

CREATE INDEX donor_last_projection_at_idx IF NOT EXISTS
FOR (d:Donor)
ON (d.lastProjectionAt);

CREATE INDEX consent_status_idx IF NOT EXISTS
FOR (c:EthicalConsent)
ON (c.status);

CREATE INDEX quality_assessment_status_idx IF NOT EXISTS
FOR (q:QualityAssessment)
ON (q.status);

CREATE INDEX telemetry_incident_status_idx IF NOT EXISTS
FOR (t:TelemetryIncident)
ON (t.status);
