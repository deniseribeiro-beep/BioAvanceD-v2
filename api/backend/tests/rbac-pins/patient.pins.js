// RBAC gate pins for patient.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/patient.routes.js',
  mount: '/api/patients',
  pins: [
    { method: 'POST', path: '/', permission: 'createPatient' },
    { method: 'POST', path: '/:id/consent/resend', permission: 'createPatient' },
    { method: 'POST', path: '/:id/observations', permission: 'createPatient' },
    { method: 'POST', path: '/:id/reidentify', permission: 'reidentifyParticipant' },
    { method: 'PUT', path: '/:id', permission: 'createPatient' },
    { method: 'DELETE', path: '/:id', permission: 'createPatient' },
    { method: 'POST', path: '/find-for-edit', permission: 'createPatient' },
  ],
};
