# 2026-10-23: BiomarkerAssociation is modelled and entered by an administrator

Dictionary ELM-0275..0285, governed values ENUM-0096..0100. Issue #1206.

## The question

The v2.0.0 entity BiomarkerAssociation (ELM-0275..0285) had no model, validation, store or route in `api/backend/src/`; only the catalog JSONs named it. How is it stored and entered, and which values does it accept?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1206, on 2026-10-23:

1. **Stored through the master-data router, with no seed.** `api/backend/src/models/BiomarkerAssociation.js` has a pure `fieldsOf`, a `validate` and a `create` that never throws, and is registered in `canonical-catalog-conformance.arch.test.js` with zero drift. It is stored through `createMasterDataRouter` at `/api/biomarker-associations`, written by roles 3 and 4, the factory's gate, as Network, Biobank and IdentifierNamespaceRegistry are. No seed: Phase 1 allows no fictitious operational data (`docs/extracted-v2.0.0/requisitos.md` line 55); a real row is entered by an administrator.
2. **`biomarkerRole` is one of `diagnostic`, `prognostic`, `risk`, `safety`, `monitoring`, `response`.** These are the English forms of ELM-0279's six purposes, read off its example `diagnostic`, because `dict-ENUMS.md` governs no biomarkerRole value. A sent value is trimmed and lower-cased before the check.
3. **`evidenceReferences` accepts only the governed DOI and PMID** (ENUM-0099/0100), as `{system, value}`: a DOI matches `10.<4-9 digits>/<suffix>`, a PMID is a positive integer of at most nine digits without a leading zero. A guideline or regulatory document, which ELM-0285's description also names, waits for a governed value.
4. **A CodeableConcept is the repo's Coding shape** `{systemUri, code, version, display}` (`LabelDefinition.js`). `analyte` is a Coding of any system (its vocabulary is open: HGNC, ChEBI, LOINC and others). Every `associatedCondition` entry is a Coding whose `systemUri` is one of the three governed URIs (ENUM-0096..0098): `http://www.orpha.net`, `http://id.who.int/icd/release/11/mms`, `http://purl.obolibrary.org/obo/mondo.owl`, those of the ORPHA, ICD-11 and MONDO reference importers. The 0..1 fields (`biospecimenMatrix`, `assayMethod`, `cutoff`, `evidenceLevel`, `regulatoryStatus`) are stored as given, as `Condition.js` stores its own.
5. **The PUT re-checks only the required fields it carries.** `biomarkerAssociation.service.js` runs the model's rules over the required keys an update sends, so an edit cannot empty `evidenceReferences` or `associatedCondition`, blank `contextOfUse` or set an unknown `biomarkerRole`, and writes a passing `biomarkerRole` back normalised.

## Not decided here

- **Retiring `disease_dictionary`**, its readers and its seed.
- **Pointing `disease-profile` and `buildLocalSemanticSuggestions`** at the new store.
- **Whether `SampleGraphValidator` ever reads it**: no RF requires it (#1206).
- **The frontend** screen that enters it.
- **A MongoDB unique index** on `biomarkerId`: decided in `2026-10-24-biomarker-association-unique-index.md` (#1402).
