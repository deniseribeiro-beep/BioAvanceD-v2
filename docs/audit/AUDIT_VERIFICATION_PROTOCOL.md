# Audit Verification Protocol

Client input accepted by `/api/audit/verify`:

```json
{
  "eventId": "..."
}
```

Optional `treeHeadId` may be supplied for disambiguation. The endpoint rejects client-supplied `root`, `proof`, `signature`, `publicKey`, or `treeSize`.

Server-side verification steps:

1. fetch the official event record;
2. fetch the official tree head;
3. reconstruct the canonical leaf and inclusion proof from server data;
4. verify the Merkle inclusion path;
5. verify the signed tree head using the registered public key for the `keyId`;
6. verify the RFC 3161 token and its message imprint;
7. verify any external witness receipt when present;
8. evaluate consistency against the previous tree head;
9. return a structured status with all failures listed.

Expected response shape:

```json
{
  "eventIntegrity": true,
  "inclusionValid": true,
  "treeHeadSignatureValid": true,
  "timestampValid": true,
  "externalWitnessValid": true,
  "consistencyValid": true,
  "overallStatus": "VALID",
  "failures": []
}
```

The independent CLI under `api/backend/scripts` must perform the same checks without trusting this endpoint as a source of truth.
