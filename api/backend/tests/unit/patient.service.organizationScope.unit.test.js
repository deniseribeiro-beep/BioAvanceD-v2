import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const patientService = require('../../src/services/patient.service');
const { createDbMock, createCollectionMock } = require('../factories/db.factory');

// #340 (RF003 AC#3): org-scoped caller sees only patients whose
// clinicalUnitId is one of their scoped organizations. Mirrors
// sample.service.test.js's listSamples organizationScope coverage — asserts
// the query object built and passed to find(), this repo's "real backend"
// proof bar for a backend-internal query-logic slice (build-loop's
// local-env overlay).
describe('patient.service listPatients - organization scope (#340)', () => {
  it('restricts the query to clinicalUnitId $in organizationIds for an organization scope', async () => {
    const patientsCollection = createCollectionMock();
    const db = createDbMock({ participants: patientsCollection });

    await patientService.listPatients(db, {
      organizationScope: { scope: 'organization', organizationIds: ['org-1', 'org-2'] }
    });

    expect(patientsCollection.find).toHaveBeenCalledWith({
      clinicalUnitId: { $in: ['org-1', 'org-2'] }
    });
  });

  it('does not filter the query for a global scope (Administrador bypass)', async () => {
    const patientsCollection = createCollectionMock();
    const db = createDbMock({ participants: patientsCollection });

    await patientService.listPatients(db, {
      organizationScope: { scope: 'global', organizationIds: [] }
    });

    expect(patientsCollection.find).toHaveBeenCalledWith({});
  });

  it('does not filter the query when no organizationScope is passed', async () => {
    const patientsCollection = createCollectionMock();
    const db = createDbMock({ participants: patientsCollection });

    await patientService.listPatients(db, {});

    expect(patientsCollection.find).toHaveBeenCalledWith({});
  });

  it('combines the organization-scope filter with an existing clinicalUnit filter', async () => {
    const patientsCollection = createCollectionMock();
    const db = createDbMock({ participants: patientsCollection });

    await patientService.listPatients(db, {
      clinicalUnit: 'Hospital X',
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
    });

    expect(patientsCollection.find).toHaveBeenCalledWith({
      clinicalUnit: 'Hospital X',
      clinicalUnitId: { $in: ['org-1'] }
    });
  });
});
