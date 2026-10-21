# 2026-10-21: a specimen's temperature exposure is a TelemetryExposureSummary per piece of its assignment path

Dictionary: TelemetryExposureSummary, V2E-0572..0588 and V2E-0638..0641 (Dicionário de Dados v2.0.0); RULE-027, VAL-019. Requirement RF009 AC5/AC6. Issue #1392.

## The question

RF009 AC5/AC6 and RULE-027 compute a specimen's temperature exposure only through the SpecimenContainerAssignment -> ContainerPositionAssignment -> RackLocationAssignment chain, over half-open intervals, and keep it as a reproducible TelemetryExposureSummary. No model, collection, service or route for it existed, and `InfluxTelemetryReadRepository` could not read by `storageLocationId`. What does a summary refer to, which limits judge its readings, how is coverage counted, and who may request one?

## Decided

Decided by inference in the #1392 work. The code is `services/telemetryExposure.service.js`, `models/TelemetryExposureSummary.js` and `InfluxTelemetryReadRepository.readingsAtLocation`.

1. **[inference] `storageAssignmentId` (V2E-0574, 1..1, Reference(StorageAssignment)) is written null, and the three chain ids (V2E-0638..0640) carry the path.** Pattern: persistencia-poliglota.md:76 keeps StorageAssignment "apenas como legado depreciado para leitura e migração", its example record (persistencia-poliglota.md:1245-1270) has no such field, and `2026-10-11-legacy-placement-chain.md` keeps StorageAssignment for historical reads only. The field stays in the record's shape, so the catalog conformance guard sees all 21 names.
2. **[inference] One summary per path piece: one SpecimenContainerAssignment, one ContainerPositionAssignment and one RackLocationAssignment each.** V2E-0638..0640 are each 1..1, so a summary names exactly one of each. A container moved between positions, or a rack moved between locations, inside the window gives one summary per piece. The piece is the three intervals' intersection, clipped to the requested window, and a reading counts when `start <= observedAt < end` and its `storageLocationId` is the rack's location then.
3. **[inference] The limits are the TemperaturePolicy that the reading's datastream `thresholdProfileId` names, with no SensorMetadata fallback.** This follows `2026-10-17-telemetry-threshold-from-datastream.md`, decision 1. Each reading is judged against its own datastream's policy. A piece whose location has no temperature datastream valid in it, a datastream whose policy is missing or has no finite `minTemp`/`maxTemp`, or a reading of a datastream that is not the location's is refused with 422 `EXPOSURE_NOT_REPRODUCIBLE`. That is RULE-027's "Block non-reproducible summary". The SensorMetadata fallback of the 2026-10-17 and 2026-10-21 records serves cold-chain availability for alerting, which a derived record does not need. Every reading read here carries a datastream anyway, since `storageLocationId` is stamped only from one (`telemetryReadingContract.js`).
4. **[inference] A reading covers the time until the next reading, at most 20 minutes.** 20 minutes is the scheduler's stale threshold (`DEFAULT_STALE_MINUTES = 20`, `scheduler.service.js`). `coverageRatio` is the covered time over the piece, and `timeOutsideThresholdSeconds` is the covered time of the readings outside their limits. An excursion is a maximal run of consecutive outside readings, and a gap over 20 minutes breaks the run. Readings that share a timestamp form one group: the group covers its interval to the next distinct timestamp once, and it is outside when any reading in it is outside. Readings are ordered by time, then telemetryReadingId (a reading without one last), then datastreamId, then value, so the result does not depend on delivery order. The gap is part of `sourceQueryHash`, and the calculation is `calculationVersion` 1.0.0.
5. **[inference] The route is `POST /api/physical-chain/specimens/:specimenId/telemetry-exposure-summaries` under `viewStorageTopology`, the permission the chain's reads take.** RULE-027's trigger is "summary requested". The record derives from data the caller can already read and changes no chain state. `viewStorageTopology` allows only READ, so the route passes READ as its explicit action, the #631 mechanism for a POST that reads, as the reidentify POST of `patient.routes.js` does. The specimen must be in the caller's organizational scope now, as the chain's location read requires.

## Not decided here

- The Neo4j projection through the outbox (dict-ENTIDADES.md:139).
- A GET of stored summaries.
- The cold-chain quarantine reading the chain.
- The real-backend Playwright proof (#1392).
