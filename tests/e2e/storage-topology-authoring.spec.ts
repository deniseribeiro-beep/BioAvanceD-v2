import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { removeSensorRegistration, closeSeedSensorDb } from './helpers/seedSensor';

// Real-backend proof for #1124: a storage topology can be built on a running
// stack through requests alone. Before POST /api/storage/topology/*, no
// request could create a StorageContainer or a StorageBox -- every spec
// that needed one (seedStorageBoxLocation, seedSensorWithFreezerSample)
// inserted it straight into Mongo. Here nothing is inserted directly: the
// equipment, the FREEZER -> SHELF -> RACK -> box chain, the sensor, the
// participant and the sample all go through the API, and createSample's
// own hierarchy walk (#462) is what proves the authored tree is usable.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF017 #1124 topology authoring e2e',
    registeredAt: new Date().toISOString(),
  };
}

test.describe('Storage topology authoring through the API (#1124) — real backend', () => {
  const authored: SeededStorageBox[] = [];
  const sensorIds: string[] = [];

  test.afterAll(async () => {
    await Promise.all(authored.map((t) => cleanupStorageBoxLocation(t).catch(() => {})));
    // cleanupStorageBoxLocation deletes sensors by a numeric locationId; the
    // API stores it as a string, and it never touches sensorMetadata, whose
    // leftovers TelemetryMonitor scans every cycle (removeSeededSensor's note).
    await Promise.all(
      sensorIds.map((id, i) => removeSensorRegistration(id, authored[i]?.freezerId ?? '000000000000000000000000').catch(() => {}))
    );
    await Promise.all([closeSeedDb(), closeSeedSensorDb()]);
  });

  test('an API-authored FREEZER -> SHELF -> RACK -> box accepts a sample, and a second FREEZER for the same equipment is refused', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const equipmentRes = await request.post(`${apiBaseURL}/api/equipment`, {
      headers: auth,
      data: { equipmentDescription: `#1124 freezer ${suffix}`, name: `UF ${suffix}`, type: 'Freezer', status: 'Active' },
    });
    expect(equipmentRes.status(), await equipmentRes.text()).toBe(201);
    const equipment = (await equipmentRes.json()).data;

    const topology = async (path: string, data: Record<string, unknown>) => {
      const res = await request.post(`${apiBaseURL}/api/storage/topology/${path}`, { headers: auth, data });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };

    const freezer = await topology('containers', {
      name: `#1124 freezer ${suffix}`, containerType: 'FREEZER', equipmentId: String(equipment.equipmentID), temperature: -80,
    });
    // The #757 join: the freezer carries the Equipment's own id, same type.
    expect(freezer.containerID).toBe(equipment.equipmentID);
    const shelf = await topology('containers', { name: `#1124 shelf ${suffix}`, containerType: 'SHELF', parentId: freezer._id });
    const rack = await topology('containers', { name: `#1124 rack ${suffix}`, containerType: 'RACK', parentId: shelf._id });
    const box = await topology('boxes', { name: `#1124 box ${suffix}`, parentId: rack._id, dimension: { rows: 8, cols: 12 } });
    expect(box.capacity).toBe(96);

    authored.push({
      boxId: box._id,
      positionCode: 'A1',
      rackId: rack._id,
      shelfId: shelf._id,
      freezerId: freezer._id,
      equipmentId: equipment._id,
      containerID: equipment.equipmentID,
    });

    const duplicate = await request.post(`${apiBaseURL}/api/storage/topology/containers`, {
      headers: auth,
      data: { name: `#1124 second freezer ${suffix}`, containerType: 'FREEZER', equipmentId: String(equipment.equipmentID) },
    });
    expect(duplicate.status(), await duplicate.text()).toBe(409);
    expect((await duplicate.json()).error).toBe('STORAGE_CONTAINER_CONFLICT');

    // createSample's RF004 gate needs an operational sensor on the freezer's
    // equipment (sensors.locationId === freezer.containerID).
    const macSuffix = Date.now().toString(16).padStart(4, '0').slice(-4);
    const sensorId = `topology-1124-${suffix}`;
    sensorIds.push(sensorId);
    const sensorRes = await request.post(`${apiBaseURL}/api/sensors`, {
      headers: auth,
      data: {
        sensorId,
        sensorType: 'temperature',
        macAddress: `AA:BB:CC:24:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`,
        locationId: String(equipment.equipmentID),
        storageContainer: freezer._id,
      },
    });
    expect(sensorRes.ok(), await sensorRes.text()).toBeTruthy();

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const sampleRes = await request.post(`${apiBaseURL}/api/samples`, {
      headers: auth,
      data: { participantId: participant.participantId, ...validSampleFields(), boxId: box._id, positionCode: 'A1' },
    });
    expect(sampleRes.status(), await sampleRes.text()).toBe(201);
  });
});
