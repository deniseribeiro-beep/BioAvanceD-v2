# 2026-10-11: a sample's tenancy key is Sample.organizationId, not its collection site

Dictionary (Dicionário de Dados v2.0.0, `docs/extracted-v2.0.0/dict-DICIONARIO.md`):

| Code | Entity | Field | Cardinality | Obligation |
|---|---|---|---|---|
| ELM-0128 | Specimen | collectionSite | 0..1 | Core |
| P1X-0103 | StorageLocation | organizationId | 1..1 | Core |
| V2E-0107 | CustodianshipAssignment | custodianOrganizationId | 1..1 | Core |
| V2E-0112 | CustodianshipAssignment | authorizationId | 1..1 | Core |

Issue #1192.

**This record is an inference.** Neither the dictionary nor the requirements say which field scopes a sample to an organization. What follows is chosen from them and from the code, and the owner may reverse it.

## The problem

`Sample.collectionSite` is two things at once. It is the recorded collection site (ELM-0128, "Organização e local onde ocorreu a coleta"), and it is the tenancy key: every sample scope check in `interface/routes/sample.routes.js` and the list filter in `sample.service.js` read it. A scoped create overwrites the site the body names with the caller's organization, so a sample collected at a partner site records the wrong site. The dictionary keeps the two apart: the site is ELM-0128, and the custodian organization is a separate reference (P1X-0103 on StorageLocation, "Organização custodiante"; V2E-0107 on CustodianshipAssignment).

## Decided

1. **`Sample.organizationId` is the tenancy key.** It is a stored local extension: Specimen has no organization row in dict-02. It holds the organization of record, read as the custodian in the sense of P1X-0103 and V2E-0107, until a CustodianshipAssignment says otherwise.
2. **The name** is the one already used for the tenancy key of Equipment, Sensor, Temperature and StorageLocation, for example `models/Equipment.js:83` and `models/Sensor.js:54` (`organizationId: data.organizationId || null`), and P1X-0103 on StorageLocation.
3. **Behaviour, as the later slices of #1192 land:**
   - readers resolve the key as `organizationId ?? collectionSite` until the backfill has run (`services/sampleTenancy.service.js`);
   - every create stamps `organizationId`;
   - the key is server-stamped only: no request body or import file sets it, and `SampleModel.create()` stores `null` until the create slices stamp it;
   - PUT cannot write it (it is not in `ALLOWED_UPDATE_FIELDS`);
   - custody keeps governing `/api/physical-chain`.
4. **The backfill** `npm run migrate:sample-organization` (`scripts/migrateSampleOrganization.js`) copies `collectionSite` into `organizationId` wherever `organizationId` is unset. It writes no other field and is idempotent.

## Chosen where the sources leave a gap

- **Why not custody.** `physicalChainScope.service.js` scopes `/api/physical-chain` by the current CustodianshipAssignment. Applied to the sample routes, that would hide every new sample from the organization that created it: `createSample` opens no custody, and it cannot open one on its own, because a CustodianshipAssignment needs an authorization (V2E-0112, `authorizationId` 1..1). The issue's Interim section rules that out. So the sample routes get a stored key, and the physical chain keeps custody.
- **The fallback reads `collectionSite`** because that is what scoped every sample until now. A sample stored before the change stays visible to exactly the organizations that saw it before, whether or not the backfill has run.

## This slice

Only the foundation, with no change in behaviour: the field on the model and its create mapping, the helper, the backfill script and this record. No reader and no create stamp moves yet, and the migration has not been run.

## Not decided here

- **A custody handover:** whether a new CustodianshipAssignment moves `organizationId`.
- **Removing the `collectionSite` fallback,** once every stored sample has an `organizationId`.
- **`Patient.clinicalUnitId`:** whether the patient side needs the same separation.
