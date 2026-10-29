# 2026-10-23: a DataFile download is served through a short-lived, single-file signed token, and every use and refusal is audited

Requirement RNF029 C5. Issue #1321.

## The question

RNF029 C5 asks to "Usar acesso temporário ou mecanismo equivalente, auditado." `GET /api/samples/:specimenId/files/:fileID/download`, `GET /api/assays/:assayId/files/:fileID/download` and `GET /api/datasets/:datasetId/files/:fileID/download` read the stored bytes and streamed them in the same authenticated response: nothing about the access was temporary, and nothing issued, expired or refused one. What is the temporary access to a DataFile binary, how long does it last, and what does the audit trail record about it?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **A download that passes its checks is a redirect to a file access token URL.** The three download handlers keep every check they had (503, 400, 404 deleted, 403 parent, 403 organization, 404 not on disk), then issue a token for that one file and answer `302` with `Location: /api/file-access?token=<token>` and `Cache-Control: no-store`. A relative Location keeps the browser, axios and Playwright on the same backend. The handlers no longer read or decrypt bytes.
2. **The token is `base64url(JSON payload) + '.' + base64url(HMAC-SHA256)`, never a JWT** (`api/backend/src/services/dataFileAccessToken.service.js`). The payload is `{ v: 1, c: <collection>, f: <file id>, u: <storageUri>, s: <user id>, j: <16 random bytes hex>, exp: <seconds> }`. `c` is one of `sample_files`, `assayFiles` and `datasetFiles`; issuing for any other collection throws.
3. **It lives 60 seconds** (`FILE_ACCESS_TOKEN_TTL_SECONDS`), with no environment variable to change it.
4. **Its key is derived from `JWT_SECRET`:** `HMAC-SHA256(JWT_SECRET, 'bioavanced:data-file-access-token:v1')`. With no `JWT_SECRET`, issuing and verifying throw, so a download answers 500 rather than serving an unsigned link.
5. **Verification checks the MAC before it parses anything,** in constant time (`constantTimeSecretEquals`). A value that is not a string, is longer than 2048 characters, is not two `[A-Za-z0-9_-]+` parts, fails the MAC, or carries a payload outside the shape above is `invalid`; one at or past `exp` is `expired`.
6. **The token rides in the query string, never the path.** The global `auditRequest` writes `req.path` into every row's message and payload, and `auditLogger.log` stores it as `metadata.request.path`, while a query is recorded only as `'present'`. No audit row, log line or error body holds the token or any part of it.
7. **`GET /api/file-access` has no `authenticate`: the token is the credential** (`fileAccess.controller.js`, `file-access.routes.js`). It answers 403 `FILE_ACCESS_TOKEN_INVALID` or `FILE_ACCESS_TOKEN_EXPIRED` for a refused token, 404 when the file was logically deleted since issue, and 403 `FILE_ACCESS_TOKEN_INVALID` when the row's `storageUri` no longer equals the token's (the file was replaced since issue).
8. **Bytes are read through `getObject`** for a row with `storageObjectVersion`, so bytes that no longer hash to their key are a 500 with no bytes sent. A row written before the object store is read from its `storagePath`. The serve path writes and unlinks nothing.
9. **Every use and every refusal is audited by the controller:** `file_access_token_used` (`success`, `info`, the file's resource type, the file id, `payload.tokenId`) and `file_access_token_refused` (`error`, `warning`, `payload.reason` of `invalid`, `expired`, `not_found` or `superseded`, with the file id and `tokenId` only once the MAC verified). The download handlers' own `file_download` row gains `accessTokenId` and `accessTokenExpiresAt`, so an issue and its use join on the token id. The global row for `/api/file-access` records the resource type `DataFile`.
10. **No new rate limiter.** `globalLimiter` already counts failed requests, and a 256-bit MAC is not guessable within it.

`[inference]` 60 seconds, because the redirect is followed at once by the same client, so the token only has to outlive one round trip. The repo's consent tokens are the precedent for a secret-bearing route that runs without a session.

`[inference]` A stateless token rather than a stored, single-use one: it needs no new collection and no write on the read path. A replay inside the 60 seconds is bounded by the expiry and the file, and each use is audited with its `tokenId`.

`[inference]` A key derived from `JWT_SECRET`, because it needs no new secret to provision in any environment. The different label and the two-part format keep a file access token out of session authentication: `jwt.verify` cannot accept one, and a session JWT has three parts and a different key, so it is `invalid` here.

## Not decided here

- **Malware scanning of uploads** (RNF029 C4).
- **The S3-compatible adapter's own presigned URL,** which may replace this token's serve path once that adapter exists.
- **The HL7, FHIR and CDA export endpoints,** which still answer in the authenticated response.
