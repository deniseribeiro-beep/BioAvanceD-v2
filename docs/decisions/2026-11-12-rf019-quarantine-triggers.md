# 2026-11-12: which RF019 triggers quarantine a specimen

Requirement RF019 AC1. Issue #1510.

## The question

RF019 AC1 names six triggers for a quarantine: a consent revocation, an environmental excursion, a nonconformance, a governance failure, an invalid reference and an invariant violation. Which of them quarantine a stored specimen and record a QuarantineAction, and which record their gap some other way?

## Decided

1. **A revocation, an excursion, a nonconformance and a governance failure quarantine the specimen and record a QuarantineAction.** The revocation through `consentQuarantine.service.js`, the excursion through `equipment-sensor-quarantine.service.js`, the nonconformance through `nonconformance.service.js`, and the governance failure through the intake wrapper (`intakeWizard.routes.js`, fixed in #1510 to record the action of a specimen its own create stored quarantined) and `SampleGraphValidator.js`'s quality failure.
2. **An invalid reference and an invariant violation name no stored specimen, so neither quarantines one.** An invalid reference is refused at `POST /api/samples` with a 4xx, quarantined as an ingestion record (not a specimen) on ingestion (`productionIngestion.js` `checkReferences`), and kept as a ReferenceImportIssue on a reference import. An invariant violation blocks the configuration change and writes an InvariantViolation, whose only outcome is `block` (V2E-0064).

Decision 2 **is an inference** of this sitting, not a dictionary statement. It is read from two patterns: RF019's entity list names ReferenceImportIssue and InvariantViolation, and neither references a Specimen (V2E-0060..0066); and the repo consistently refuses, or quarantines as a record, an input whose reference does not resolve, rather than storing it (RF029 AC3, #664).

## Not decided here

- **A reference that turns invalid after the specimen is stored.** The compliance graph maps a clinical or pharmacology failure to `unavailable`, not `quarantined`; whether such a failure should quarantine is left open.
