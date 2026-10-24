# 2026-10-24: one BiomarkerAssociation row per biomarkerId, held by a unique index

Dictionary ELM-0275. Issue #1402.

## The question

`biomarkerAssociations` had no index at all, so nothing refused two rows with one `biomarkerId`: a POST naming an existing `biomarkerId` inserted a second row. What holds `biomarkerId` unique, and what does a duplicate POST answer?

## Decided

`[inference]`, from the repo's pattern of answering a duplicate-key refusal (E11000) as 409 where the insert happens (`deviceLifecycle.service.js`, `physicalChain.service.js`), by the coordinator for #1402, on 2026-10-24:

1. **One row per `biomarkerId`, held by a MongoDB unique index.** `api/backend/src/utils/biomarkerAssociationIndexes.js` builds `{ biomarkerId: 1 }` unique as `uniq_biomarkerId`, and the Foundation job builds it before the APIs start (`INDEX_TARGETS` in `src/foundation/indexes.js`). The index, not a pre-insert read, is what holds under concurrent posts.
2. **A duplicate POST answers 409.** The master-data router's POST, where every master-data mount inserts, answers a driver error with code 11000 as `409 Registro duplicado`; every other error keeps its status code, else 500. The PUT cannot write `biomarkerId`, which is excluded from its updatable fields.

## Not decided here

- **The frontend** screen that enters a BiomarkerAssociation.
- **Deduplicating rows already stored**: a stack already holding duplicate `biomarkerId` rows fails this build, which the Foundation job reports as `ok: false`; no migration is decided.
