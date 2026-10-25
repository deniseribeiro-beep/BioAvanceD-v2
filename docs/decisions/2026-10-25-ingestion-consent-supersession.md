# 2026-10-25: an ingested Consent may supersede the participant's consent in force, only when the record names it and its decision is newer, and the supersession is written only after the record has won its idempotency key

Requirement RF029 AC3, AC6, RF010 AC4, AC5. Dictionary ELM-0088..0113 (Consent), ELM-0093, V2E-0121..0131 (ConsentDecisionEvent). Issue #1318.

## The question

`POST /api/ingestion/records` with `entityType: 'Consent'` refused every record for a participant who already had a consent in force: 409 `CONSENT_ALREADY_ACTIVE` (`2026-10-24-ingestion-consent-target.md`, item C). The consent mount (`consent.service.js` `createPatientConsent`) supersedes a consent in force through its history (RF010 AC5). The 2026-10-24 record refused supersession because the no-transaction path, which loses an idempotency race after its writes, cannot undo one. Production runs MongoDB standalone (`compose.yml` and `compose.prod.yml` set no `--replSet`), so that path is the production path. Can ingestion supersede a consent in force, and on what evidence?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-25. Every decision below is an inference, not a citation. The pattern: the mount supersedes through history, never by overwriting a manifestation (RF010 AC5, `2026-10-08-consent-history.md`); a target reuses the mount's writes; a gate accepts only on positive evidence (Specimen's consent gate); a lookup error is never a verdict.

A. **`canonical.v1.consent` gains an optional `supersedesConsentId`** (a non-empty string): the `consentId` of the consent in force the record supersedes. The intake contract is unchanged: its `consent` sets `supersedesConsentId` to `false`, beside `participantId` and `responses`.

B. **The gate** (`consentTarget.js` `validateConsentReferences`) reads every consent of the participant with status `ACTIVE`, `VALID` or `GRANTED`, with no catch, and accepts only on positive evidence:

   | consents in force | `supersedesConsentId` | verdict |
   |---|---|---|
   | none | absent | passes, as before |
   | none | present | 409 `CONSENT_SUPERSESSION_INVALID`: nothing to supersede |
   | one or more | absent | 409 `CONSENT_ALREADY_ACTIVE`, the old refusal, for every record that does not name one |
   | more than one | present | 409 `CONSENT_SUPERSESSION_INVALID`: one name cannot supersede several, and superseding the others would be silent |
   | exactly one | present | accepts only when the name is a string equal to that consent's key (`consentHistory.consentKeyOf`), the prior carries no `supersededByConsentId` (a claim another record holds, in flight or left by a failure), the prior's `signedAt` parses to a time and the record's `consentAcceptedAt` is strictly after it; anything else is 409 `CONSENT_SUPERSESSION_INVALID` |

   A refusal's message names consent ids, never responses.

C. **Before the transaction**, `prepareDocument` reads the participant's consents in force again, with no catch, and picks the one the record names. One gone since the gate is a plain failure, never a verdict, and no evidence is stored. It stamps `supersedesConsentId` on the new document, as the mount stamps it, and answers the prior as `supersedes`.

D. **The supersession is written only after the record has won its idempotency key**, through a new optional target key, `appendAfterAccept`, which only Consent carries (`supersedeConsentInForce`). On a replica set it runs in the insert's transaction, after the key is recorded in it. Without a transaction it runs after the key is recorded, never on the loser's path. A loser therefore never touches the prior, and no decision event is ever deleted from another consent's append-only history (RF010 AC4). This removes the problem the 2026-10-24 record refused on.

E. **One conditional claim decides the supersession:** an `updateOne` on the prior, filtered on its `_id`, a status in force and no `supersededByConsentId`, setting `supersededByConsentId` to the new consent. Only when it modifies the prior does `consentHistory.recordSupersession` append the `superseded` decision event and recompute the prior's derived state (`superseded`, status `REVOKED`), under the staff-portal actor the acceptance uses. A prior revoked or superseded since the gate is never rewritten. No outbox event is written for the prior, as the mount writes none.

F. **A claim that fails aborts only in a transaction.** With a session, it throws, the transaction aborts, and nothing of the record is persisted. Without one, the record is already accepted under its key, so the step writes nothing and returns: superseding a consent revoked in the meantime would rewrite its derived state to `superseded`.

G. **Without a transaction, a history write that fails after the claim releases it.** A conditional `updateOne` sets `supersededByConsentId` back to null where it still names the new consent, and the error is rethrown. The prior is never left in force with a mark that refuses every later supersession, and the gate's refusal of a marked prior (item B) never blocks it for good. In a transaction the abort undoes the claim.

## Not decided here

- **Two concurrent ingestions with different keys for one participant.** Both can pass the gate; the claim lets only one supersede the prior, but both successors stay in force.
- **Revocation by ingestion.**
- **A failure of the after-accept step without a transaction**, which leaves the new consent accepted beside the prior. The claim is released (item G), but a failure after the `superseded` decision event was appended and before the recompute leaves that event in the prior's history; the next recompute of the prior derives it as superseded.
- **An outbox or Neo4j event for the superseded prior.**
