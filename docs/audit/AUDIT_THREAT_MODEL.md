# Audit Threat Model

Threat model for the audit subsystem.

- Application administrator
  - may manage users and configuration;
  - must not be able to rewrite events, leaves, roots, or tree heads.

- Normal application credential
  - may insert events and read them;
  - must not update or delete events or roots.

- MongoDB administrator
  - can alter stored bytes;
  - such tampering should be detected by signature and external anchoring.

- Host administrator
  - can change application and database bytes;
  - cannot produce a valid signature without the external signing key;
  - cannot rewrite evidence that has already been published into an independent domain.

- Key compromise
  - historical records remain verifiable;
  - key rotation must be recorded;
  - history is not rewritten.

- TSA unavailable
  - tree heads remain pending timestamping;
  - the system must not claim anchoring success;
  - retries must be idempotent.

- Simultaneous compromise of database, signing key, and external anchor
  - outside the assurance boundary;
  - must be documented explicitly as out of scope.

The implementation is designed around detection and external verification, not absolute impossibility of mutation.
