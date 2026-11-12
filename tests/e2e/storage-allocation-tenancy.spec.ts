import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import {
  createRealParticipant,
  seedActiveConsent,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { removeSensorRegistration, closeSeedSensorDb } from './helpers/seedSensor';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// Real-backend proof for #1211: the storage allocation mutations are bounded
// by the caller's organization. Before it, a Tecnico of one organization
// could release, move or allocate another organization's specimen given its
// id, or place their own specimen into another organization's box -- the
// routes checked the permission code and nothing else.
//
// A specimen's organization is its collectionSite (#1192 tracks separating
// that from the recorded site); a box's is its root freezer's Equipment's
// (#1210). Both trees here are authored through the API, so the scope walk
// runs over real ids and the real #757 containerID join, not fixtures.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF006 #1211 storage tenancy e2e',
    registeredAt: new Date().toISOString(),
  };
}

test.describe('Storage allocation is bounded by the caller organization (#1211) — real backend', () => {
  const authored: SeededStorageBox[] = [];
  const sensorIds: string[] = [];
  // #1282: the organizations the tests create, deleted after the trees under them.
  const organizationIds: string[] = [];
  // #1497 (RF004 AC2): the collection these specimens enter.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`rf006-tenancy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async ({ request }) => {
    await Promise.all(authored.map((t) => cleanupStorageBoxLocation(t).catch(() => {})));
    await Promise.all(
      sensorIds.map((id, i) => removeSensorRegistration(id, authored[i]?.freezerId ?? '000000000000000000000000').catch(() => {}))
    );
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await cleanupGovernedCollection(governed);
    await Promise.all([closeSeedDb(), closeSeedSensorDb(), closeGovernedCollectionDb()]);
  });

  async function buildTree(request: APIRequestContext, auth: Record<string, string>, organizationId: string, label: string) {
    const equipmentRes = await request.post(`${apiBaseURL}/api/equipment`, {
      headers: auth,
      data: { equipmentDescription: `#1211 ${label}`, name: `UF ${label}`, type: 'Freezer', status: 'Active', organizationId },
    });
    expect(equipmentRes.status(), await equipmentRes.text()).toBe(201);
    const equipment = (await equipmentRes.json()).data;

    const topology = async (path: string, data: Record<string, unknown>) => {
      const res = await request.post(`${apiBaseURL}/api/storage/topology/${path}`, { headers: auth, data });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };
    const freezer = await topology('containers', {
      name: `#1211 freezer ${label}`, containerType: 'FREEZER', equipmentId: String(equipment.equipmentID), temperature: -80,
    });
    const shelf = await topology('containers', { name: `#1211 shelf ${label}`, containerType: 'SHELF', parentId: freezer._id });
    const rack = await topology('containers', { name: `#1211 rack ${label}`, containerType: 'RACK', parentId: shelf._id });
    const box = await topology('boxes', { name: `#1211 box ${label}`, parentId: rack._id, dimension: { rows: 8, cols: 12 } });

    authored.push({
      boxId: box._id,
      positionCode: 'A1',
      rackId: rack._id,
      shelfId: shelf._id,
      freezerId: freezer._id,
      equipmentId: equipment._id,
      containerID: equipment.equipmentID,
    });

    // createSample's RF004 gate needs an operational sensor on the freezer's
    // equipment (sensors.locationId === freezer.containerID).
    const macSuffix = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    const sensorId = `tenancy-1211-${label}`;
    sensorIds.push(sensorId);
    const sensorRes = await request.post(`${apiBaseURL}/api/sensors`, {
      headers: auth,
      data: {
        sensorId,
        sensorType: 'temperature',
        macAddress: `AA:BB:CC:11:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`,
        locationId: String(equipment.equipmentID),
        storageContainer: freezer._id,
      },
    });
    expect(sensorRes.ok(), await sensorRes.text()).toBeTruthy();
    return { boxId: box._id as string, freezerId: freezer._id as string };
  }

  test('a Tecnico scoped to one organization cannot release, move or read across organizations, and still can within its own', async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeOrg = async (label: string) => {
      const res = await request.post(`${apiBaseURL}/api/organizations`, {
        headers: adminAuth,
        data: { officialName: `#1211 ${label} ${suffix}`, countryCode: 'BR' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const organizationId = (await res.json()).data.organizationId as string;
      organizationIds.push(organizationId);
      return organizationId;
    };
    const ownOrg = await makeOrg('own');
    const otherOrg = await makeOrg('other');

    const ownTree = await buildTree(request, adminAuth, ownOrg, `own ${suffix}`);
    const otherTree = await buildTree(request, adminAuth, otherOrg, `other ${suffix}`);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);

    // The Administrador is global, so the body's collectionSite stands (#1071).
    const createSample = async (collectionSite: string, positionCode: string) => {
      const res = await request.post(`${apiBaseURL}/api/samples`, {
        headers: adminAuth,
        data: { participantId: participant.participantId, ...validSampleFields(), collectionSite, boxId: ownTree.boxId, positionCode, collectionId: governed!.collectionId },
      });
      expect([201, 202], await res.text()).toContain(res.status());
      const id = (await res.json()).data.specimenId as string;
      expect(id).toBeTruthy();
      return id;
    };
    const ownSample = await createSample(ownOrg, 'A1');
    const foreignSample = await createSample(otherOrg, 'A2');

    const username = `tec.1211.${Date.now()}`;
    const password = 'Tecnico@12345-forte';
    const registerRes = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: {
        name: '#1211 Tecnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
        organizationId: ownOrg,
      },
    });
    expect(registerRes.ok(), await registerRes.text()).toBeTruthy();
    const tecnico = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const tecAuth = { Authorization: `Bearer ${tecnico.token}` };

    // Another organization's specimen, sitting in the Tecnico's own box.
    const foreignRelease = await request.delete(`${apiBaseURL}/api/storage/release/${foreignSample}`, { headers: tecAuth });
    expect(foreignRelease.status(), await foreignRelease.text()).toBe(403);
    expect((await foreignRelease.json()).error).toBe('SAMPLE_OUT_OF_SCOPE');

    // The Tecnico's own specimen, into another organization's box.
    const foreignMove = await request.post(`${apiBaseURL}/api/storage/move`, {
      headers: tecAuth,
      data: { sampleId: ownSample, targetBoxId: otherTree.boxId, targetPosition: 'B2', reason: '#1211 cross-organization move' },
    });
    expect(foreignMove.status(), await foreignMove.text()).toBe(403);
    expect((await foreignMove.json()).error).toBe('EQUIPMENT_OUT_OF_SCOPE');

    // Controls, same caller and same routes: in-organization release and
    // allocate succeed, so the two 403s are the scope check and not a
    // missing permission, and the root-freezer walk resolves a real tree.
    const ownRelease = await request.delete(`${apiBaseURL}/api/storage/release/${ownSample}`, { headers: tecAuth });
    expect(ownRelease.status(), await ownRelease.text()).toBe(200);

    const ownAllocate = await request.post(`${apiBaseURL}/api/storage/allocate`, {
      headers: tecAuth,
      data: { sampleId: ownSample, boxId: ownTree.boxId, position: 'C3' },
    });
    expect(ownAllocate.status(), await ownAllocate.text()).toBe(201);

    // The reads: another organization's specimen and freezer are refused by
    // id, and the freezer list names only the caller's own.
    const foreignLocation = await request.get(`${apiBaseURL}/api/storage/sample/${foreignSample}`, { headers: tecAuth });
    expect(foreignLocation.status(), await foreignLocation.text()).toBe(403);
    expect((await foreignLocation.json()).error).toBe('SAMPLE_OUT_OF_SCOPE');

    const foreignTree = await request.get(`${apiBaseURL}/api/storage/freezer/${otherTree.freezerId}/tree`, { headers: tecAuth });
    expect(foreignTree.status(), await foreignTree.text()).toBe(403);
    expect((await foreignTree.json()).error).toBe('EQUIPMENT_OUT_OF_SCOPE');

    const ownAvailable = await request.get(`${apiBaseURL}/api/storage/box/${ownTree.boxId}/available`, { headers: tecAuth });
    expect(ownAvailable.status(), await ownAvailable.text()).toBe(200);

    const freezersRes = await request.get(`${apiBaseURL}/api/storage/freezers`, { headers: tecAuth });
    expect(freezersRes.status(), await freezersRes.text()).toBe(200);
    const freezerIds = ((await freezersRes.json()).data as Array<{ _id: string }>).map((f) => String(f._id));
    expect(freezerIds).toContain(ownTree.freezerId);
    expect(freezerIds).not.toContain(otherTree.freezerId);

    // Control for the list filter: the Administrador still sees both.
    const adminFreezers = await request.get(`${apiBaseURL}/api/storage/freezers`, { headers: adminAuth });
    const adminIds = ((await adminFreezers.json()).data as Array<{ _id: string }>).map((f) => String(f._id));
    expect(adminIds).toEqual(expect.arrayContaining([ownTree.freezerId, otherTree.freezerId]));
  });
});
