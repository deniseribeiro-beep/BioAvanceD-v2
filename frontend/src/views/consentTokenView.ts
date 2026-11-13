// Pure helpers behind ConsentTokenPage (#809), the participant-facing page for
// the bulk consent-token system: the opaque 64-char hex token minted by
// NotificationService.buildConsentMetadata, carried by every link
// buildConsentLink emails, and consumed by
// POST /api/e-consent/consent-tokens/{validate,accept}.
//
// Kept separate from the component so the parsing/normalisation rules are unit
// tested directly, per this repo's frontend testing convention.

import { classifyRequestFailure } from './requestFailure';

export type ConsentTokenPermission = {
  key: string;
  label: string;
  required: boolean;
};

export type ConsentTokenTemplate = {
  id: string;
  title: string;
  content: string;
  version: string | null;
  permissions: ConsentTokenPermission[];
};

export type ConsentTokenParams =
  | { ok: true; participantId: string; token: string }
  | { ok: false; message: string };

// A route param or query value that is literally the string 'undefined'/'null'
// is not a value -- it is a template hole that was interpolated anyway. #805
// emailed `/patients/undefined/consent` from all four bulk invitation paths,
// and those links are still in participants' inboxes.
const PLACEHOLDER_VALUES = new Set(['undefined', 'null', 'nan']);

function cleanParam(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return '';
  return trimmed;
}

export function resolveConsentTokenParams(
  rawParticipantId: string | null | undefined,
  rawToken: string | null | undefined
): ConsentTokenParams {
  const participantId = cleanParam(rawParticipantId);
  const token = cleanParam(rawToken);

  if (!participantId || !token) {
    return {
      ok: false,
      message:
        'Este link de consentimento está incompleto. Solicite um novo convite à equipe do biobanco.',
    };
  }

  return { ok: true, participantId, token };
}

function normalizePermission(raw: unknown): ConsentTokenPermission | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { key?: unknown; label?: unknown; required?: unknown };
  const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  if (!key || !label) return null;
  return { key, label, required: candidate.required === true };
}

export function normalizeConsentTemplate(raw: unknown): ConsentTokenTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  const content = typeof candidate.content === 'string' ? candidate.content.trim() : '';
  // No content means there is no term to show. Rendering an accept button over
  // an empty box would collect a consent to nothing.
  if (!content) return null;

  const permissions = Array.isArray(candidate.permissions)
    ? candidate.permissions.map(normalizePermission).filter((p): p is ConsentTokenPermission => p !== null)
    : [];

  return {
    id: typeof candidate.id === 'string' ? candidate.id : '',
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : 'Termo de Consentimento',
    content,
    version: typeof candidate.version === 'string' && candidate.version.trim() ? candidate.version.trim() : null,
    permissions,
  };
}

// #821: the manifestation the page submits -- one boolean per purpose, keyed
// the way ConsentTemplate.permissions is and createPatientConsent validates.
// Every purpose starts declined, so nothing is recorded as granted that the
// participant did not tick.
export function initialConsentResponses(permissions: ConsentTokenPermission[]): Record<string, boolean> {
  return Object.fromEntries(permissions.map(permission => [permission.key, false]));
}

// Labels of the required purposes not yet accepted. The accept button stays
// disabled while this is non-empty: the backend refuses such an answer set,
// and a term cannot be accepted without its required purposes.
export function missingRequiredPermissions(
  permissions: ConsentTokenPermission[],
  responses: Record<string, boolean>
): string[] {
  return permissions
    .filter(permission => permission.required && responses[permission.key] !== true)
    .map(permission => permission.label);
}

export type ConsentPanelLocation =
  | { status: 'unavailable' }
  | { status: 'captured'; latitude: number; longitude: number; accuracyMeters: number | null; capturedAt: string | null };

export function readPanelLocation(): Promise<ConsentPanelLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        status: 'captured',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      () => resolve({ status: 'unavailable' }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

export function mapConsentTokenError(status?: number): string {
  if (status === 422) {
    // #821: the link was accepted as valid but the answers could not be
    // recorded as sent -- usually because the term was republished after this
    // page loaded. A reload shows the current term; a new invitation would not
    // help, so the copy keeps the link-is-still-good promise of the 503 arm.
    return 'O termo de consentimento foi atualizado ou suas respostas estão incompletas. Seu link continua válido -- recarregue a página e responda novamente.';
  }
  if (status === 400) {
    return 'Link inválido ou expirado. Solicite um novo convite à equipe do biobanco.';
  }
  if (status === 503) {
    // Something on our side failed, not the link: the term could not be loaded,
    // the token check could not run, or the acceptance could not be written
    // (#1127). The one thing all three have in common is that requesting a new
    // invitation would not help, so the copy must not suggest it -- it says the
    // link is still good and asks for a retry instead. It also does not claim
    // the acceptance was recorded, because on the accept route it was not.
    return 'O serviço de consentimento está temporariamente indisponível. Seu link continua válido -- tente novamente em alguns minutos.';
  }
  return 'Não foi possível carregar seu termo de consentimento. Tente novamente em alguns minutos.';
}

// #1152: mapConsentTokenError decides by STATUS, and in a real outage there is no
// response to take a status from. Measured on a live stack 2026-09-22: the backend
// answers 503 after 30s (mongo stopped) or 60s (partitioned) -- serverSelectionTimeoutMS
// is 30000 on the native client -- while api.ts aborts at its own 10s timeout. So the
// participant NEVER received the 503 #1127 shipped; axios threw ECONNABORTED with no
// `response`, the mapper got undefined, and they got the generic arm instead.
//
// This takes the whole error rather than a status, so the "no response at all" case
// is distinguishable from "a response we have no arm for".
export function mapConsentTokenRequestError(error?: unknown): string {
  const failure = classifyRequestFailure(error);
  if (failure.kind === "response") {
    return mapConsentTokenError(failure.status);
  }

  // A request left the browser and nothing came back: our own timeout, a dropped
  // connection, a DNS failure. The CAUSE differs -- it can be their network rather
  // than ours -- but the participant's situation does not: the link is not spent and
  // retrying is the right advice. The copy therefore makes only the promise all of
  // them share, and deliberately does not assert the service is down, which would be
  // wrong when their own connection dropped.
  if (failure.kind === "no-response") {
    return 'Não foi possível falar com o serviço de consentimento. Seu link continua válido -- tente novamente em alguns minutos.';
  }

  // Neither a response nor a request: the throw never reached the network, so it is a
  // fault in this page rather than an outage. Claiming either would be a guess.
  return mapConsentTokenError(undefined);
}
