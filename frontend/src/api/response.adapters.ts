type ApiRecord = Record<string, any>;

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapApiPayload<T = unknown>(input: unknown): T | unknown {
  if (isRecord(input) && 'data' in input && ('status' in input || 'headers' in input || 'config' in input)) {
    return input.data;
  }

  return input;
}

export function extractResponseItems<T = any>(input: unknown, collectionKeys: string[] = []): T[] {
  const payload = unwrapApiPayload(input);
  const candidates: unknown[] = [payload];

  if (isRecord(payload)) {
    candidates.push(payload.data, payload.items, payload.results);

    if (isRecord(payload.data)) {
      candidates.push(payload.data.data, payload.data.items, payload.data.results);
    }

    collectionKeys.forEach((key) => {
      candidates.push(payload[key]);
      if (isRecord(payload.data)) {
        candidates.push(payload.data[key]);
      }
    });
  }

  const found = candidates.find((candidate) => Array.isArray(candidate));
  return Array.isArray(found) ? (found as T[]) : [];
}

/** The list total, from `data.total` when the page is an object, else from the body. */
export function extractResponseTotal(input: unknown, fallback: number): number {
  const payload = unwrapApiPayload(input);
  if (!isRecord(payload)) return fallback;
  if (isRecord(payload.data) && typeof payload.data.total === 'number' && Number.isFinite(payload.data.total)) {
    return payload.data.total;
  }
  if (typeof payload.total === 'number' && Number.isFinite(payload.total)) return payload.total;
  return fallback;
}

export function extractResponseEntity<T extends ApiRecord = ApiRecord>(input: unknown, fallback: ApiRecord = {}): T {
  const payload = unwrapApiPayload(input);
  const candidate = isRecord(payload)
    ? payload.data ?? payload.item ?? payload.entity ?? payload
    : payload;

  return isRecord(candidate) ? ({ ...fallback, ...candidate } as T) : ({ ...fallback } as T);
}

function pickString(source: ApiRecord, keys: string[]): string {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return '';
}

function pickBoolean(source: ApiRecord, keys: string[], fallback = true): boolean {
  for (const key of keys) {
    if (source?.[key] !== undefined) {
      return Boolean(source[key]);
    }
  }

  return fallback;
}

export function normalizeMasterDataItem<T extends ApiRecord = ApiRecord>(item: unknown, idKeys: string[] = []): T {
  const source = isRecord(item) ? item : {};
  const id = pickString(source, [...idKeys, 'id', '_id', 'value', 'slug', 'code', 'codigo']);
  const code = pickString(source, ['code', 'codigo', 'value', 'slug', ...idKeys, 'id']);
  const description = pickString(source, ['description', 'descricao', 'name', 'label', 'title', 'display']);
  const name = pickString(source, ['name', 'label', 'title', 'description', 'descricao', 'display']);
  const label = pickString(source, ['label', 'name', 'title', 'description', 'descricao', 'display']);
  const active = pickBoolean(source, ['active', 'ativo', 'is_active'], true);

  return {
    ...source,
    ...(id && source.id === undefined ? { id } : {}),
    ...(code && source.code === undefined ? { code } : {}),
    ...(description && source.description === undefined ? { description } : {}),
    ...(name && source.name === undefined ? { name } : {}),
    ...(label && source.label === undefined ? { label } : {}),
    active,
    is_active: source.is_active !== undefined ? Boolean(source.is_active) : active,
  } as unknown as T;
}
