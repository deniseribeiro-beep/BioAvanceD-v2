# 2026-10-13: every sample is created with a specimenRole

Dictionary: Specimen.specimenRole, ELM-0121 (code 1..1 Core, `primary|aliquot|derivative|pool|control`, ENUM-0053..0057), maintained from v1.3.0 ("No action; validate against v2 schema"); REL-0175 Specimen.parentSpecimenIds "Derivation lineage; aliquot is a new Specimen" (Dicionário de Dados v2.0.0). Issue #1201.

## Decided

1. **The five values are the dictionary's:** `primary`, `aliquot`, `derivative`, `pool`, `control`. `models/Sample.js` holds them as `SPECIMEN_ROLE_VALUES`. A given value is trimmed and lower-cased; any other value is refused.
2. **A create without a role gets a default:** `derivative` when it names parents (`parentSpecimenIds`, ELM-0120), else `primary`. `SampleModel.create` sets it, so every create path carries it: `POST /api/samples`, `/api/users/register-sample`, the intake wizard, the batch engine and both imports.
3. **The role agrees with the parents.** `SampleModel.validate` refuses a `primary` or a `control` with parents, and an `aliquot` or a `derivative` without one. A `pool` has no parent rule. `POST /api/samples` refuses an unknown role early with 422; the parent check is the model's.
4. **The role is set at creation only.** Like `parentSpecimenIds`, it is not in `updateSample`'s `ALLOWED_UPDATE_FIELDS`.
5. **Readers use `SampleModel.resolveSpecimenRole`** until the backfill (`migrate:specimen-role`, next commit) has run: the stored role when it is one of the five, else the default a create would have given the document.

## Chosen where the sources leave a gap

- **The default for a sample with parents is `derivative`.** The dictionary names no default; the JSON example (`03_specimen_mongodb.json`) shows only `primary` with no parents. A sample with parents is not primary, and nothing sent tells an aliquot from a derivative, so the wider term is used. A caller that knows it is an aliquot says so.
- **The parent rule.** REL-0175 makes an aliquot "a new Specimen" in a derivation lineage, so an aliquot and a derivative name their parent, and a primary or a control has none.

## Not decided here

- **Pool composition.** Which specimens a pool is made of (poolComponents) is not modelled; a `pool` is accepted with or without parents.
- **A role for an import row.** An import sends none, so its sample gets the default.
- **The dictionary's "ou outro"** in ELM-0121's definition. The vocabulary lists five codes and no `other`, so none is accepted.
