// RF011 AC1/AC3, RNF024 C1 (#1322): the conformance rows the FHIR validator
// reads by default. `profiles` are FHIRProfileRegistry rows, `namespaces` are
// IdentifierNamespaceRegistry rows, and `approvedAuthorities` are RULE-036's
// explicitly approved external hosts.
//
// All three are empty on purpose: the requisitos populate profiles and
// mappings in Phase 2, and Phase 1 holds no fictitious operational data, so
// no row is invented here. Until then every declared profile and every
// identifier.system is refused (see
// docs/decisions/2026-10-23-fhir-validator-version-profile-identifier-system.md).
module.exports = Object.freeze({
  profiles: Object.freeze([]),
  namespaces: Object.freeze([]),
  approvedAuthorities: Object.freeze([]),
});
