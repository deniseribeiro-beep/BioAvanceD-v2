export interface SampleMovementItem {
  id: string;
  timestamp: string;
  type: string;
  responsible: string;
  details: string;
  metadata?: unknown;
}

export interface ComplianceError {
  message: string;
  code: string | null;
}

interface MovementPayload {
  data?: unknown;
}

interface MovementRawItem {
  _id?: string | number;
  id?: string | number;
  timestamp?: string;
  createdAt?: string;
  date?: string;
  type?: string;
  responsibleName?: string;
  responsible?: string;
  operatorName?: string;
  userAnonId?: string;
  user?: string;
  details?: string;
  description?: string;
  observations?: string;
  note?: string;
  metadata?: unknown;
}

interface ApiLikeError {
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string;
    };
  };
  message?: string;
}

export function normalizeMovementList(payload: unknown): SampleMovementItem[] {
  const typedPayload = payload as MovementPayload | null;
  const rawItems = Array.isArray(typedPayload?.data)
    ? typedPayload.data
    : Array.isArray(payload)
      ? payload
      : [];

  return rawItems.map((rawItem, index: number) => {
    const item = rawItem as MovementRawItem;
    return {
    id: String(item?._id || item?.id || `${item?.timestamp || item?.createdAt || 'movement'}-${index}`),
    timestamp: item?.timestamp || item?.createdAt || item?.date || '—',
    type: item?.type || '—',
    responsible:
      item?.responsibleName ||
      item?.responsible ||
      item?.operatorName ||
      item?.userAnonId ||
      item?.user ||
      '—',
    details:
      item?.details ||
      item?.description ||
      item?.observations ||
      item?.note ||
      '—',
    metadata: item?.metadata,
    };
  });
}

export function parseComplianceError(error: unknown): ComplianceError {
  const typedError = error as ApiLikeError | null;
  const status = typedError?.response?.status;
  const backendMessage = typedError?.response?.data?.message || typedError?.response?.data?.error || typedError?.message || '';
  const normalizedMessage = String(backendMessage).toLowerCase();

  if (status === 403 && (normalizedMessage.includes('consent') || normalizedMessage.includes('revog'))) {
    return {
      code: 'CONSENT_REVOKED',
      message: 'Acesso bloqueado: consentimento revogado para esta amostra. Evento registado para auditoria.',
    };
  }

  if (status === 403 && (normalizedMessage.includes('ética') || normalizedMessage.includes('etica') || normalizedMessage.includes('ethical'))) {
    return {
      code: 'ETHICS_AUTH_REQUIRED',
      message: 'Acesso bloqueado: falta autorização ética para consultar esta cadeia de custódia. Evento registado para auditoria.',
    };
  }

  return {
    code: status ? `HTTP_${status}` : null,
    message: backendMessage || 'Erro ao carregar movimentos',
  };
}
