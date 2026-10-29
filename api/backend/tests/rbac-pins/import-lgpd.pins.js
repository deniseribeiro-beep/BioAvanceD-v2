// RBAC gate pins for import-lgpd.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/import-lgpd.routes.js',
  mount: '/api/import-lgpd',
  pins: [
    { method: 'POST', path: '/pacientes', permission: 'createPatient' },
    { method: 'POST', path: '/pacientes/smart-import', permission: 'createPatient' },
    { method: 'GET', path: '/pacientes/smart-import/reports', permission: 'createPatient' },
    { method: 'GET', path: '/pacientes/smart-import/metadata', permission: 'createPatient' },
    { method: 'POST', path: '/amostras', permission: 'createSample' },
    { method: 'GET', path: '/batches', permission: 'createSample' },
    { method: 'GET', path: '/batches/:batchId', permission: 'createSample' },
    { method: 'POST', path: '/batches/:batchId/records/:recordId/resubmit', permission: 'createSample' },
    { method: 'GET', path: '/pacientes/template/csv', permission: 'createPatient' },
    { method: 'GET', path: '/pacientes/template/xlsx', permission: 'createPatient' },
    { method: 'GET', path: '/amostras/template/csv', permission: 'createSample' },
    { method: 'GET', path: '/amostras/template/xlsx', permission: 'createSample' },
  ],
};
