// Pure helpers behind EConsentPage and EConsentImportPage (#822), the two
// participant-facing pages on the JWT token system:
//   - GET  /api/e-consent/validate/:token          -> the term + prior answers
//   - POST /api/e-consent/update                   -> accept / revoke
//   - GET  /api/e-consent/import/fhir/consent/:token
//   - POST /api/e-consent/import/fhir/consent/:token/accept
//
// Kept separate from the components so the parsing/normalisation rules are unit
// tested directly, per this repo's frontend testing convention. Same split as
// consentTokenView.ts (#809), which covers the *other* token system.

import { classifyRequestFailure } from './requestFailure';

export type EConsentPermission = {
  key: string;
  label: string;
  required: boolean;
};

export type EConsentTemplate = {
  id: string;
  title: string;
  permissions: EConsentPermission[];
};

export type EConsentSnapshot = {
  patientName: string;
  template: EConsentTemplate | null;
  responses: Record<string, boolean>;
};

function normalizePermission(raw: unknown): EConsentPermission | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { key?: unknown; label?: unknown; required?: unknown };
  const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  if (!key || !label) return null;
  return { key, label, required: candidate.required === true };
}

export function normalizeEConsentTemplate(raw: unknown): EConsentTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  const permissions = Array.isArray(candidate.permissions)
    ? candidate.permissions
        .map(normalizePermission)
        .filter((p): p is EConsentPermission => p !== null)
    : [];

  // A term with no answerable permission has nothing to manifest about --
  // rendering a save button over an empty list would record a consent to
  // nothing, the same reasoning as normalizeConsentTemplate's empty-content
  // guard (#809).
  if (permissions.length === 0) return null;

  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const title =
    typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : 'Termo de Consentimento';

  return { id, title, permissions };
}

/**
 * Only booleans survive: the backend stores `responses` as an object of
 * booleans (consent.service.js's patientConsentSchema declares
 * `additionalProperties: { type: 'boolean' }`), but a stale document could
 * carry anything, and a truthy non-boolean would silently pre-tick a box the
 * participant never ticked.
 */
export function normalizeEConsentResponses(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const normalized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') normalized[key] = value;
  }
  return normalized;
}

export function normalizeEConsentSnapshot(raw: unknown): EConsentSnapshot {
  const candidate = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const patient = (candidate.patient && typeof candidate.patient === 'object'
    ? candidate.patient
    : {}) as Record<string, unknown>;

  const patientName =
    typeof patient.patientName === 'string' && patient.patientName.trim()
      ? patient.patientName.trim()
      : 'Paciente';

  return {
    patientName,
    template: normalizeEConsentTemplate(candidate.template),
    responses: normalizeEConsentResponses(candidate.responses),
  };
}

/**
 * The wire shape POST /e-consent/update expects: one entry per permission the
 * template declares, so an unticked box is sent as an explicit REVOKED rather
 * than omitted. Driven by the template, not by the answers object, so a
 * permission the participant never touched still gets a decision.
 */
export function buildConsentUpdatePayload(
  template: EConsentTemplate | null,
  answers: Record<string, boolean>
): Array<{ key: string; status: 'ACCEPTED' | 'REVOKED' }> {
  if (!template) return [];
  return template.permissions.map((permission) => ({
    key: permission.key,
    status: answers[permission.key] ? 'ACCEPTED' : 'REVOKED',
  }));
}

/** Every permission set to false -- the "Revogar Todos" action. */
export function buildRevokeAllAnswers(template: EConsentTemplate | null): Record<string, boolean> {
  if (!template) return {};
  return Object.fromEntries(template.permissions.map((permission) => [permission.key, false]));
}

/**
 * #822: before this, every one of these requests returned the SPA's
 * index.html with a 200, so the pages could only ever show their generic
 * "link inválido" message -- a real 401 and a served-HTML non-answer were
 * indistinguishable. Now that the calls reach the backend, the status is
 * meaningful and worth reflecting.
 */
export function mapEConsentError(status?: number): string {
  if (status === 401 || status === 400) {
    return 'Link inválido ou expirado. Solicite novo acesso.';
  }
  if (status === 404) {
    return 'Não encontramos seu cadastro. Solicite novo acesso à equipe do biobanco.';
  }
  return 'Não foi possível carregar seu termo de consentimento. Tente novamente em alguns minutos.';
}

export function mapEConsentSubmitError(status?: number): string {
  if (status === 401 || status === 400) {
    return 'Link inválido ou expirado. Solicite novo acesso.';
  }
  if (status === 422) {
    // #820: createPatientConsent rejects a signature-less manifestation.
    return 'Não foi possível registrar seu consentimento. A equipe do biobanco foi notificada.';
  }
  return 'Erro ao atualizar consentimento.';
}

// #1158: the status-only mappers above get `undefined` in a real outage, because
// api.ts aborts at its own 10s timeout before the backend's 503 arrives (30s+).
// These take the whole error, so "no response at all" is distinguishable from
// "a response we have no arm for" -- the same split #1152 made on ConsentTokenPage.
export function mapEConsentRequestError(error?: unknown): string {
  const failure = classifyRequestFailure(error);
  if (failure.kind === 'response') return mapEConsentError(failure.status);
  if (failure.kind === 'no-response') {
    return 'Não foi possível falar com o serviço de consentimento. Seu link continua válido -- tente novamente em alguns minutos.';
  }
  return mapEConsentError(undefined);
}

export function mapEConsentSubmitRequestError(error?: unknown): string {
  const failure = classifyRequestFailure(error);
  if (failure.kind === 'response') return mapEConsentSubmitError(failure.status);
  if (failure.kind === 'no-response') {
    // Deliberately does not say the consent was NOT recorded: a slow success can
    // land after the client gave up. Retrying is safe on both routes -- /update's
    // JWT is not single-use, and acceptImportConsentToken returns early on an
    // already-signed record.
    return 'Não foi possível confirmar o registro do seu consentimento. Seu link continua válido -- tente novamente em alguns minutos.';
  }
  return mapEConsentSubmitError(undefined);
}
