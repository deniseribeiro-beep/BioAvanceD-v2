const DEFAULT_BASE_URL = 'https://api.orphacode.org';
const DEFAULT_LANGS = ['PT', 'EN'];
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 2;
const ALLOWED_API_LANGS = new Set(['CS', 'DE', 'EN', 'ES', 'FR', 'IT', 'NL', 'PL', 'PT']);

const DETAIL_ENDPOINTS = [
  'Name',
  'Synonym',
  'Definition',
  'Typology',
  'Status',
  'OrphanetURL',
  'ClassificationLevel',
  'ICD10',
  'ICD11',
  'OMIM',
  'SNOMED-CT',
  'PreferentialParent',
  'PreferentialChildren',
  'ORPHAcodeAggregation',
  'TargetEntity',
  'Classification',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

function shouldRetry(error) {
  if (!error?.status) return true;
  return error.status === 429 || error.status >= 500;
}

function parseLanguages(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || DEFAULT_LANGS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.map(normalizeApiLang);
}

function normalizeApiLang(lang) {
  const apiLang = String(lang || '').trim().toUpperCase();
  if (!ALLOWED_API_LANGS.has(apiLang)) {
    throw new Error(`Invalid ORPHAcodes API language "${lang}". Allowed values: ${Array.from(ALLOWED_API_LANGS).join(', ')}`);
  }
  return apiLang;
}

class OrphacodeApiClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.ORPHACODE_BASE_URL);
    this.apiKey = options.apiKey || process.env.ORPHACODE_API_KEY || process.env.ORPHACODE_USERNAME || options.username || 'bioavanced-local';
    this.langs = parseLanguages(options.langs);
    this.delayMs = Number(options.delayMs ?? process.env.ORPHACODE_DELAY_MS ?? 250);
    this.concurrency = Math.max(Number(options.concurrency ?? process.env.ORPHACODE_CONCURRENCY ?? 2), 1);
    this.timeoutMs = Number(options.timeoutMs ?? process.env.ORPHACODE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.retries = Number(options.retries ?? DEFAULT_RETRIES);
    this.quiet = Boolean(options.quiet);
    this.lastRequestAt = 0;
  }

  buildUrl(pathname, params = {}) {
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${this.baseUrl}${normalizedPath}${buildQuery(params)}`;
  }

  async throttle() {
    if (!this.delayMs) return;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.delayMs) {
      await sleep(this.delayMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  async fetchJson(pathname, params = {}, options = {}) {
    const url = this.buildUrl(pathname, params);
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        await this.throttle();
        if (!this.quiet) console.log(`[orphanet-api] GET ${pathname} attempt=${attempt + 1}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            apiKey: this.apiKey,
          },
          signal: controller.signal,
        });
        const text = await response.text();
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (_error) {
            payload = text;
          }
        }
        if (response.status === 404 && options.allowNotFound) {
          return null;
        }
        if (!response.ok) {
          const message = payload?.message || payload?.error || `HTTP ${response.status}`;
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error?.name === 'AbortError'
          ? new Error(`Timeout after ${this.timeoutMs}ms`)
          : error;
        if (!this.quiet) console.warn(`[orphanet-api] failed ${pathname}: ${lastError.message}`);
        if (lastError.status === 404 || !shouldRetry(lastError) || attempt >= this.retries) {
          break;
        }
        if (attempt < this.retries) {
          await sleep(500 * (attempt + 1));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  async clinicalEntities(lang, params = {}) {
    const apiLang = normalizeApiLang(lang);
    return this.fetchJson(`/${apiLang}/ClinicalEntity`, params);
  }

  async clinicalEntity(lang, orphacode) {
    const apiLang = normalizeApiLang(lang);
    return this.fetchJson(`/${apiLang}/ClinicalEntity/orphacode/${encodeURIComponent(orphacode)}`);
  }

  async clinicalEntityResource(lang, orphacode, resource) {
    const apiLang = normalizeApiLang(lang);
    return this.fetchJson(
      `/${apiLang}/ClinicalEntity/orphacode/${encodeURIComponent(orphacode)}/${resource}`,
      {},
      { allowNotFound: true }
    );
  }

  async clinicalEntityResources(lang, orphacode, resources = DETAIL_ENDPOINTS) {
    const output = {};
    let index = 0;

    const worker = async () => {
      while (index < resources.length) {
        const resource = resources[index];
        index += 1;
        try {
          output[resource] = await this.clinicalEntityResource(lang, orphacode, resource);
        } catch (error) {
          output[resource] = { error: error.message };
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.concurrency, resources.length) }, () => worker());
    await Promise.all(workers);
    return output;
  }
}

module.exports = {
  OrphacodeApiClient,
  DETAIL_ENDPOINTS,
  normalizeApiLang,
  parseLanguages,
};
