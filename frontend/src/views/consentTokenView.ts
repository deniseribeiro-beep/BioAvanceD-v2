// Pure helpers behind ConsentTokenPage (#809), the participant-facing page for
// the bulk consent-token system: the opaque 64-char hex token minted by
// NotificationService.buildConsentMetadata, carried by every link
// buildConsentLink emails, and consumed by
// POST /api/e-consent/consent-tokens/{validate,accept}.
//
// Kept separate from the component so the parsing/normalisation rules are unit
// tested directly, per this repo's frontend testing convention.

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

export function mapConsentTokenError(status?: number): string {
  if (status === 400) {
    // #836: opaque message (#823) also covers republished/replaced invitations.
    return 'Link inválido, expirado ou substituído por uma versão mais recente do termo. Solicite um novo convite à equipe do biobanco.';
  }
  if (status === 503) {
    // The token was accepted; the term itself could not be loaded.
    return 'O termo de consentimento está indisponível no momento. Tente novamente em alguns minutos.';
  }
  return 'Não foi possível carregar seu termo de consentimento. Tente novamente em alguns minutos.';
}
