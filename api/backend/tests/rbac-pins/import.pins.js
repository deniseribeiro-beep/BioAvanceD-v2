// RBAC gate pins for import.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/import.routes.js',
  mount: '/api/import',
  pins: [
    { method: 'POST', path: '/batch', permission: 'uploadFiles' },
    { method: 'GET', path: '/batch/:jobId', permission: 'uploadFiles' },
    { method: 'GET', path: '/status/:jobId', permission: 'uploadFiles' },
    { method: 'GET', path: '/batch/quarantine/:id', permission: 'uploadFiles' },
    { method: 'POST', path: '/fhir/stage', permission: 'uploadFiles' },
    { method: 'GET', path: '/fhir/batches/:id', permission: 'uploadFiles' },
    { method: 'POST', path: '/fhir/batches/:id/validate', permission: 'uploadFiles' },
    { method: 'POST', path: '/fhir/batches/:id/send-consents', permission: 'uploadFiles' },
    { method: 'GET', path: '/fhir/batches/:id/consent-status', permission: 'uploadFiles' },
    { method: 'POST', path: '/fhir/batches/:id/commit', permission: 'uploadFiles' },
    { method: 'POST', path: '/fhir/batches/:id/records/:recordId/external-document', permission: 'uploadFiles' },
    { method: 'POST', path: '/validate', permission: 'uploadFiles' },
    { method: 'POST', path: '/import', permission: 'uploadFiles' },
    { method: 'POST', path: '/import/samples', permission: 'uploadFiles' },
    { method: 'POST', path: '/upload', permission: 'uploadFiles' },
  ],
};
