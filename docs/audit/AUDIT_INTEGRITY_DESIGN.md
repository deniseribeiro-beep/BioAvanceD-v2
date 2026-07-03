# Audit Integrity Design

This design implements an append-only, tamper-evident, signed and externally verifiable audit trail for BioAvanceD.

The implementation is aligned with RFC 3161 for timestamping, RFC 9162 for Merkle-tree log structure, and NIST SP 800-92 for audit-log management. It also follows the historical foundations described by Haber and Stornetta and by Schneier and Kelsey.

Core properties:

- append-only event records in `audit_events`;
- deterministic JSON canonicalization before hashing and signing;
- per-log monotonic `sequenceNumber` and `previousEventHash` chaining;
- Merkle leaf separation with `0x00` and node separation with `0x01`;
- signed tree heads that always carry `treeSize` and `rootHash` together;
- asymmetric signing with a key separate from any encryption secret;
- RFC 3161 timestamping over the signed tree-head digest;
- independent witness anchoring through a separate trust domain when available;
- no client-supplied root, proof, public key, or timestamp material in `/api/audit/verify`.

The current codebase already had legacy audit primitives, but those primitives accepted mock or fallback behavior. The v2 services introduced in this change separate the canonicalization, tree, signing, TSA, and witness responsibilities so they can be verified independently.

Operational notes:

- A timestamp failure leaves the tree head in a pending state instead of fabricating success.
- A witness failure leaves the tree head anchored only to the TSA result.
- Historical roots remain stored; new corrections are modeled as new events instead of overwrite.
- Administrators of the application or MongoDB can modify bytes, but verification is intended to detect that unless both external anchors and the signing trust are compromised.

References:

- RFC 3161, Internet X.509 PKI Time-Stamp Protocol.
- RFC 5816, ESSCertIDv2 Update for RFC 3161.
- RFC 9162, Certificate Transparency Version 2.0.
- NIST SP 800-92, Guide to Computer Security Log Management.
- Haber and Stornetta, How to Time-Stamp a Digital Document.
- Schneier and Kelsey, Secure Audit Logs to Support Computer Forensics.
