# 2026-10-07: what ends an account's sessions, and what deleting an account does

Requirements: RF001 AC4, RF003 AC4, RNF008 C7, RNF021 C2 and RNF022 C5, Requisitos v4.0.0; dictionary P1X-0193 (UserAccount accountStatus). Issue #1306.

## Decided

1. **These end every live session of the account, recorded as `admin_action`:** a status that leaves `active` (`inactive`, `blocked` or `suspended`), a change of access level, a grant or removal of the auditor role, and a delete. A logout ends the session it was sent on, as before.
2. **A role change ends the sessions whichever way it goes.** RNF021 C2 names "alteração crítica de papel" without saying which changes are critical. The access token carries the level it was issued with until it is renewed, so a promotion leaves a token below the new level and a demotion leaves one above it. Both are ended.
3. **An echoed unchanged status or level, a reactivation and an ordinary profile edit end nothing.** The edit form sends the whole record back on every save.
4. **`authenticate` and `POST /api/auth/refresh` refuse an account whose status is not `active`**, as login already did. A stored document with no status reads as `active`, as `UserModel.normalizeStatus` defines.
5. **`DELETE /api/users/:id` inactivates the account.** It sets `status: 'inactive'` and ends the sessions. The document, its audit trail and its role history are kept, and the users list shows the account as Inativo. The hierarchy floor (#1008) and the 404 for an unknown id are unchanged.

## Why delete writes no deletion field

RF003 AC4 asks to "inativar a conta sem excluir o histórico", and RNF022 C5 asks for inactivation or pseudonymisation in place of a destructive delete. The dictionary's UserAccount (P1X-0182..0208) has `accountStatus` and no deletion timestamp or deleted-by field, so a delete is an inactivation and the audit row (`DELETE` on `User`) records who did it and when. A distinct "deleted" state would be a new field outside the dictionary. Pseudonymising the account's personal fields is a separate step that no source ties to the delete, and it is not built here.
