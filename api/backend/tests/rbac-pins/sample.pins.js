// RBAC gate pins for sample.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/sample.routes.js',
  mount: '/api/samples',
  pins: [
    { method: 'POST', path: '/', permission: 'createSample' },
    { method: 'POST', path: '/:id/withdraw', permission: 'withdrawSample' },
    { method: 'PUT', path: '/:id', permission: 'editSample' },
    { method: 'DELETE', path: '/:id', permission: 'deleteSample' },
    { method: 'POST', path: '/:id/return', permission: 'withdrawSample' },
    { method: 'POST', path: '/:specimenId/files/upload', permission: 'uploadSampleFiles' },
    { method: 'DELETE', path: '/:specimenId/files/:fileID', permission: 'deleteSampleFiles' },
    { method: 'PUT', path: '/:specimenId/files/:fileID/replace', permission: 'uploadSampleFiles' },
  ],
};
