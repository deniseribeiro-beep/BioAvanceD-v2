# 2026-10-13: a scoped caller may link a sample to another organization's participant, and writes nothing on it

Dictionary (Dicionário de Dados v2.0.0, `docs/extracted-v2.0.0/dict-DICIONARIO.md`):

| Code | Entity | Field | Cardinality | Obligation |
|---|---|---|---|---|
| ELM-0076 | Participant | participantId | 1..1 | Core |
| ELM-0117 | Specimen | participantId | 1..1 | Core |
| ELM-0089 | Consent | participantId | 1..1 | Core |
| ELM-0195 | Encounter | participantId | 1..1 | Core |
| P1X-0356 | ParticipantIdentity | clinicalUnitId | 0..1 | Condicional |

Issue #1356.

**This record is an inference.** Neither the dictionary nor the requirements say whether a caller scoped to one organization may link a sample to a participant another organization registered. What follows is chosen from them and from the code, and the owner may reverse it.

## The problem

`matchOrUpsertParticipant` (`services/PatientIdentityService.js`) matches a participant by `participantId` or by name and birth date across every organization. Since #1356's first slices, a scoped caller passes its scope, and a match outside it comes back with `outOfScope: true` and its identity left unwritten. But both callers still wrote onto the matched `patients` document after creating the sample: `lastClinicalData` with this sample's clinical data and `linkedSampleIds` with the new sample. So organization A's importer or intake rewrote organization B's participant record and put A's clinical data on it. And whether the link itself is allowed rested on #1192, which has since landed.

## Decided

1. **A scoped caller may link its sample to a participant outside its scope.** That covers the LGPD sample import, its quarantine resubmit (the same `processSampleRow`) and the intake wizard. A participant is one person, `participantId` (ELM-0076) is global, and a person may give samples at several organizations. Refusing the link would force a second identity for the same person.
2. **The link moves no ownership.** The sample's tenancy key is its own `Sample.organizationId` (the 2026-10-11 sample-tenancy record), never the participant's `clinicalUnitId`. A sample linked to B's participant stays A's sample.
3. **Nothing is written on an out-of-scope participant:** not `patients` (sex, cpf, `lastClinicalData`, `linkedSampleIds`), not `participantIdentities`. The import and the intake skip their `patients` update when the match is `outOfScope`. Neither `lastClinicalData` nor `linkedSampleIds` has a reader, so the out-of-scope caller loses nothing it could see. The intake's audit event records `outOfScope` and says the patient was linked without update.
4. **Unchanged:** a global caller (no organization scope) never gets `outOfScope`, so its update still runs; an in-scope match and a new participant are updated as before.

## Chosen where the sources leave a gap

Recorded here, not changed by #1356:

- **The intake's consent decision reads the participant's consents whatever organization recorded them.** A Consent carries the participant (ELM-0089) and no organization, and consent belongs to the person.
- **The intake's clinical entities** (Encounter, ELM-0195, and the rest) are created against the linked `participantId`, because clinical history belongs to the person too.

## Not decided here

- **`Patient.clinicalUnitId`** as both a recorded fact (P1X-0356) and the participant's tenancy key (#1376).
