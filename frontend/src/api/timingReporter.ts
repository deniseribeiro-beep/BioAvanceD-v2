/**
 * RNF001 C4 (#1469): the browser times each axios call and posts the timings
 * to POST /api/monitoring/frontend-timings, where the Administrador reads them
 * beside the HTTP metrics. No user data is sent: a timing is a method, a path
 * with its query dropped and every id segment written :id, and a duration.
 * The report goes through fetch, never axios, so it is never timed itself.
 */
import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { fetchWithRequestId } from './requestId';

export interface FrontendTiming {
  name: string;
  ms: number;
}

// The backend's limits for a timing and a batch, mirrored from
// api/backend/src/infrastructure/metrics/frontendTimings.js; the tests post
// through that file's parser.
const NAME_PATTERN = /^(GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/_:.-]*$/;
const MAX_NAME_LENGTH = 200;
const MAX_MS = 600000;
const MAX_QUEUED = 50;
const FLUSH_AT = 20;
const FLUSH_AFTER_MS = 15000;

const KEPT_SEGMENT = /^[a-z_-]+$|^v[0-9]+$/;

const starts = new WeakMap<object, number>();
let queue: FrontendTiming[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let reportBase: string | undefined;

export function timingLabel(method: string, fullUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(fullUrl, 'http://localhost').pathname;
  } catch {
    return null;
  }
  const path = pathname
    .split('/')
    .map((segment) => (segment === '' || KEPT_SEGMENT.test(segment) ? segment : ':id'))
    .join('/');
  const name = `${method.toUpperCase()} ${path}`;
  if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) return null;
  return name;
}

function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

export function flushTimings(): Promise<void> {
  clearTimer();
  const timings = queue.splice(0, MAX_QUEUED);
  const token = localStorage.getItem('token');
  if (timings.length === 0 || !token || reportBase === undefined) return Promise.resolve();
  try {
    return fetchWithRequestId(`${reportBase}/monitoring/frontend-timings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timings }),
    }).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function enqueue(timing: FrontendTiming) {
  queue.push(timing);
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
  if (queue.length >= FLUSH_AT) {
    void flushTimings();
    return;
  }
  if (timer === undefined) {
    timer = setTimeout(() => {
      timer = undefined;
      void flushTimings();
    }, FLUSH_AFTER_MS);
  }
}

function record(instance: AxiosInstance, config: InternalAxiosRequestConfig | undefined) {
  if (!config) return;
  const start = starts.get(config);
  if (start === undefined) return;
  starts.delete(config);
  const name = timingLabel(config.method ?? 'get', instance.getUri(config));
  if (name === null) return;
  const ms = Math.round(performance.now() - start);
  // One out-of-range ms makes the route refuse the whole batch; a call that
  // spans a suspended laptop is dropped so the others still post.
  if (!(ms >= 0 && ms <= MAX_MS)) return;
  enqueue({ name, ms });
}

export function installTimingReporter(instance: AxiosInstance): void {
  if (reportBase === undefined) reportBase = instance.defaults.baseURL ?? '';
  instance.interceptors.request.use((config) => {
    starts.set(config, performance.now());
    return config;
  });
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      record(instance, response.config);
      return response;
    },
    (error: AxiosError) => {
      record(instance, error?.config);
      return Promise.reject(error);
    },
  );
}

export function resetTimingReporterForTests(): void {
  clearTimer();
  queue = [];
  reportBase = undefined;
}
