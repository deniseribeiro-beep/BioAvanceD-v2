// RF011 AC1/AC2/AC3, RNF024 C1/C2 (#1322): the base conformance rows the FHIR
// validator reads. `profiles` are FHIRProfileRegistry rows, `namespaces` are
// IdentifierNamespaceRegistry rows, and `approvedAuthorities` are RULE-036's
// explicitly approved external hosts. At import validation,
// loadConformanceRegistry (identifierNamespaceRegistry.service.js) adds the
// stored IdentifierNamespaceRegistry rows (/api/identifier-namespaces) and
// the stored FHIRProfileRegistry rows (/api/fhir-profiles) to this base; a
// part whose store is unreadable keeps this base alone for that part.
//
// All three are empty on purpose: the requisitos populate profiles and
// mappings in Phase 2, and Phase 1 holds no fictitious operational data, so
// no row is invented here. Until an administrator enters a real row, every
// declared profile and every identifier.system is refused (see
// docs/decisions/2026-10-23-fhir-validator-version-profile-identifier-system.md
// and docs/decisions/2026-10-23-interoperability-mapping-release-store.md).
module.exports = Object.freeze({
  profiles: Object.freeze([]),
  namespaces: Object.freeze([]),
  approvedAuthorities: Object.freeze([]),
});
