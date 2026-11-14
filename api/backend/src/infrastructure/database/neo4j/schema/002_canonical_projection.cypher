// =============================================
// BioAvanceD - Neo4j Canonical Projection
// =============================================

// Canonical labels used by stage 1:
// Donor, Sample, EthicalConsent, RareDisease, Phenotype,
// Biomarker, BiomarkerObservation, QualityAssessment,
// CustodyEvent, StoragePosition, TelemetryIncident, ResearchProject,
// TerminologyConcept

// Canonical relationships used by stage 1:
// Donor-[:DONATED]->Sample
// Donor-[:CONSENTED_UNDER]->EthicalConsent
// Sample-[:GOVERNED_BY]->EthicalConsent
// Sample-[:DERIVED_FROM]->Sample
// Sample-[:HAS_CUSTODY_EVENT]->CustodyEvent
// CustodyEvent-[:FROM]->StoragePosition
// CustodyEvent-[:TO]->StoragePosition
// Sample-[:STORED_AT]->StoragePosition
// Sample-[:HAS_QUALITY_ASSESSMENT]->QualityAssessment
// Sample-[:AFFECTED_BY]->TelemetryIncident
