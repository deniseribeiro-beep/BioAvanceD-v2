import { APIRequestContext } from '@playwright/test';

export interface AuditWatch {
  date: string;
  leafCountBefore: number;
}

interface DashboardStats {
  date: string;
  leafCount: number;
  hl7Count: number;
  tampered: boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchStats(
  request: APIRequestContext,
  apiBaseURL: string,
  token: string,
  date: string
): Promise<DashboardStats> {
  const response = await request.get(`${apiBaseURL}/api/audit/dashboard/stats/${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`assertAuditEvent: GET /api/audit/dashboard/stats/${date} failed (${response.status()}): ${body}`);
  }

  const body = await response.json();
  return body?.data;
}

/**
 * Captures today's audit leaf count before an action, so a later call to
 * assertAuditEventRecorded can prove the action appended to the real audit
 * trail (RF012 / the traceability doc's "assert the audit trail, not just
 * the primary outcome" cross-cutting rule).
 *
 * leafCount comes from GET /api/audit/dashboard/stats/:date, which recomputes
 * the Merkle tree over the `logs` collection live (integrityCheckService.
 * buildMerkleForDate) — every audited action mirrors into this collection
 * synchronously (see log.service.js's ingestLogRecord call), so this is safe
 * to read immediately before/after an action. This deliberately does NOT use
 * POST /api/audit/verify's full chain-integrity check (Merkle root + RFC3161
 * timestamp + external witness): that verification depends on a daily tree-
 * head anchor job (daily-merkle.job.js, ~02:30 UTC) that hasn't run yet for
 * "today" during a normal test run, so an event created moments ago has no
 * anchored tree head to verify against. Use `audit-e2e-real.js` as the
 * reference if a spec ever needs to prove the anchor/witness chain itself.
 */
export async function watchAuditTrail(
  request: APIRequestContext,
  apiBaseURL: string,
  token: string
): Promise<AuditWatch> {
  const date = todayUtc();
  const stats = await fetchStats(request, apiBaseURL, token, date);
  return { date, leafCountBefore: stats.leafCount };
}

/**
 * Asserts the action taken between watchAuditTrail() and this call appended
 * at least `minNewEvents` entries to the real audit trail. Throws (rather
 * than returning a boolean) so a caller can't accidentally ignore a
 * false-pass — per this project's "tests are honest or they're worthless"
 * rule.
 */
export async function assertAuditEventRecorded(
  request: APIRequestContext,
  apiBaseURL: string,
  token: string,
  watch: AuditWatch,
  minNewEvents = 1
): Promise<void> {
  const stats = await fetchStats(request, apiBaseURL, token, watch.date);
  const delta = stats.leafCount - watch.leafCountBefore;

  if (delta < minNewEvents) {
    throw new Error(
      `assertAuditEventRecorded: expected >= ${minNewEvents} new audit event(s) for ${watch.date}, got ${delta} ` +
        `(before=${watch.leafCountBefore}, after=${stats.leafCount})`
    );
  }
}
