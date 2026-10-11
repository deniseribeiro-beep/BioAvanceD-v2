# 2026-10-11: report grants use their dictionary names

Dictionary: AccessGrant, P1X-0238..0250 (Dicionário de Dados v2.0.0). Requirements: RF002 AC4 "O Usuário Externo visualiza somente dados e relatórios previamente autorizados", Requisitos v4.0.0. Issue #1201 (its AccessGrant line); the pattern is #1330's, recorded in `2026-10-11-user-account-names.md`.

## Decided

1. **`access` documents are written under the canonical names:** `accessGrantId` (was `accessID`, P1X-0238, uuid 1..1 Core) and `userAccountId` (was `userId`, P1X-0239, Reference(UserAccount) 1..1 Core). `models/Access.js` holds the map (`RENAMED`). A new grant carries neither old name.
2. **`accessGrantId` is a `crypto.randomUUID()`.** Before, `accessID` was whatever the request body sent, or null. A body that still sends `accessID`, or `accessGrantId`, keeps its value as the grant's `accessGrantId`, so no caller of `POST /api/access` breaks; such a value is not checked to be a uuid, and no index makes it unique. The update route never writes either name: the id is the grant's identity (#875).
3. **`permissionCodes` (P1X-0243, code[] 1..* Core) is written on every new grant.** The default is `['viewReports']`: a report grant authorizes reading the report it names, which is what `viewReports` means in the RBAC catalog (`rbac-catalog-seed.service.js`). The server sets it: a report grant always carries `['viewReports']`, and a body naming any other list is refused with 422 (#1372). A report grant must never carry a privilege; a caller-chosen list such as `['manageUsers']` would turn it into one for the first reader that trusts the field. Nothing reads the list yet: the RF002 AC4 check still authorizes by the grant's report id and type.
4. **Readers fall back to the old names** for a grant written before them. `AccessModel.accessGrantIdOf` and `userAccountIdOf` read the canonical name first, then the legacy one; only an absent canonical name falls back. The RF002 AC4 grant check (`report-grant.service.js`) matches the caller under `userAccountId` or `userId`.
5. **Every write uses the canonical name.** `POST /api/access` takes the beneficiary from `userAccountId`, or the API's `userId`. `PUT /api/access/:id` takes either and stores `userAccountId`, with `$unset: { userId: '' }` in the same update.
6. **The API keeps its keys.** List, read and create responses go through `AccessModel.apiViewOf`, which returns `accessGrantId` under `accessID` and `userAccountId` under `userId`. `permissionCodes` is a new key in those responses. The frontend reads neither renamed field and is unchanged.
7. **The collection stays `access`.** Only field names change.

## Unchanged

The routes' permission gates, the revocation (grantStatus `revoked`), the grant's report fields (`reportID`, `reportType`, `accessType`, `resourceType`, `resourceId`) and which reports an external user may read. Routes still find a grant by its Mongo `_id`; no route looked a grant up by `accessID`, so none needed a fallback lookup.

## Indexes

No index is defined on `access`, so none needed a canonical twin.

## Chosen where the sources leave a gap

- **`reportType` and `accessType` keep their names.** dict-02 declares them as the Access model's own legacy fields, `reportTypeLegacy` (P1X-0242) and `accessTypeLegacy` (P1X-0244), both 0..1 Extensão local. The conformance guard records both as drift under #1201.
- **`reportID` stays beside `resourceId`.** It is the API's key and the one the grant check reads first; `resourceId` carries the same value under its canonical name.

## Not decided here

- **Removing the legacy fallback.** A grant written before this change keeps `accessID` and `userId` until something rewrites it; the update route moves only `userId`, and only when the request sets the beneficiary. Dropping the fallback needs a one-off backfill of every old grant, which is not written.
- **Backfilling `permissionCodes`** on grants written before this change.
- **`createdAt` and `updatedAt`.** AccessGrant has no row for either; the conformance guard records them under #1201.
