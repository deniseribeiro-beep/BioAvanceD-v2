# 2026-10-21: the cold-chain quarantine also quarantines the specimens the physical chain puts at the excursion's location

Dictionary: V2E-0638..0640 (Dicionário de Dados v2.0.0). Requirement RF009 AC5, RULE-027. Issue #1392.

## The question

A cold-chain incident quarantined only the samples under the sensor's freezer boxes (`findBoxIdsBySensorKey`: `sensors`, `sensorMetadata`, the datastream's mirrored freezer). A specimen placed through the normalized chain (SpecimenContainerAssignment -> ContainerPositionAssignment -> the rack read from the position id -> RackLocationAssignment) at the location the sensor's datastream monitors was not selected unless it also sat in a legacy box. Which specimens does the quarantine select, over which window, and by which key?

## Decided

Decided by inference in the #1392 work, from `findBoxIdsBySensorKey`, `physicalChain.service.js`, `telemetryExposure.service.js`, the incident writers and 2026-10-21-sensor-readers-from-datastream.md. The chain is read by `physicalChain.specimenIdsAtLocation`; the quarantine's lookup is `findChainSpecimenIdsBySensorKey`.

1. **[inference] The quarantine adds the chain's specimens to the union of the box paths, which stay.** It selects the specimens whose SCA -> CPA -> RLA chain is, at some instant of the excursion window, at the `storageLocationId` of a temperature datastream of the sensor valid during that window, in addition to every box path. A failed chain lookup is logged as a warning and adds nothing, so the box paths still apply. Pattern: 2026-10-21-sensor-readers-from-datastream.md decisions 2 and 3 (cold-chain availability wins; the datastream adds to the union, never replaces it).
2. **[inference] The excursion window is `[excursionStartedAt, now]`, else `[openedAt, now]`, else the instant `now`.** Pattern: #1207's clock is the incident's `excursionStartedAt` (iot.controller.js); the manual incident (incident.controller.js) carries only `openedAt`; TelemetryMonitor's missing-reading incident carries neither, and its datastream readers read the stream valid now (decision 1 of 2026-10-21-sensor-readers-from-datastream.md). Each chain interval is half-open, as the chain writes it (#1314), and the window is closed, so an assignment placed at `now` is in it.
3. **[inference] A chain specimen is matched by `specimenId` or by `String(_id)`.** These are the two keys `legacyPlacementChain.service.js` writes into the chain: the business `specimenId`, else the legacy sample's `_id`. The `_id` is compared through `$toString`, never as an ObjectId built here, for #912's handle-agnostic reason.

## Not decided here

- **The real-backend Playwright proof of the chain quarantine.**
- **The EnvironmentalExcursion or TemperatureIncident naming the quarantined specimens.**
