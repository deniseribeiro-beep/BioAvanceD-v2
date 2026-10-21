# 2026-10-21: each SensorMetadata row's binding is moved onto a temperature TelemetryDatastream by a one-shot migration

Dictionary: TelemetryDatastream, V2E-0562..0571 (Dicionário de Dados v2.0.0). Requirement RF017 AC5. Issue #1392.

## The question

#1392's first slice moved the SensorMetadata readers onto the temperature TelemetryDatastream valid now, with SensorMetadata as their fallback. No datastream existed for a sensor registered before that. A datastream needs seven fields; a SensorMetadata row holds `sensorId`, `macAddress`, `equipment`, `device`, `storageContainer` and `temperaturePolicy`, and registration writes only the last two. Where does each datastream field come from, and what does the migration leave alone?

## Decided

Decided by inference in the #1392 work, from the TelemetryDatastream model, SensorMetadata.schema.js and the repo's earlier migrations. `npm run migrate:sensor-metadata-to-datastreams` applies it; `-- --dry-run` counts and writes nothing.

1. **[inference] The sampling policy is the `--sampling-policy-id` argument, checked as a stored ConfigurationProfile `profileId`.** No SensorMetadata field carries one, and V2E-0568 is 1..1. Pattern: the `--organization-id` argument of the 2026-10-14 facility-room migration, a value that cannot be derived, supplied on the command line and refused when not stored, so nothing is written. An applied run without it is refused; a dry run without it counts and reports `samplingPolicyId: null`.
2. **[inference] `equipmentId` is the freezer's `containerID`, else the row's `equipment`.** Pattern: the repo joins a freezer to its Equipment by `containerID === equipmentID` (#462, #464, `organizationIdFor` in legacyPlacementChain.service.js). Registration leaves `equipment` null, so the freezer is the source that is set. A row with neither is listed as `no_equipment` and not written.
3. **[inference] `storageLocationId` is the freezer's mirrored location, coded `legacy-storage-container:<_id>` (#1379), and none is created.** Pattern: the placement chain is what mirrors a freezer as a location (2026-10-11 legacy placement chain, 2026-10-14 facility-room locations). A row whose freezer is missing or not mirrored is listed as `freezer_not_located`; a row with no `temperaturePolicy` is listed as `no_policy`, since `thresholdProfileId` is 1..1 and is the policy's id (2026-10-17 threshold decision 3).
4. **[inference] Validity starts at the run.** Pattern: the 2026-10-17 reading decision 4, old documents are not migrated. A reading stored before the run keeps the binding it was stored with, and only a later reading is interpreted through the new datastream. A sensor with a temperature datastream open or valid at the run is counted as `alreadyBound` and not written, so a second run writes nothing.
5. **[inference] SensorMetadata is not deleted or changed; it stays the readers' fallback.** Pattern: the slice 1 readers fall back to it, as the 2026-10-17 threshold decision 2 keeps it for an unbound reading. sensorMetadata, storageContainers and storageLocations are only read; the datastream is written through `createDatastream`, so its validation and overlap refusal apply.

## Not decided here

- **The registration writer.** sensor.service.js still writes the binding onto SensorMetadata, not a datastream, so a sensor registered after the run has none until the migration runs again (#1392).
- **The excursion's `device` key.** SensorMetadata's `device` has no TelemetryDatastream field, and the readers that need it still read SensorMetadata (#1392).
