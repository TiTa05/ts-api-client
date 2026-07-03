import axios, { AxiosError } from 'axios';
import type { GenericAbortSignal } from 'axios';

import { toAxiosHeaders } from './headers';

export function getResponseHeader(error: AxiosError, name: string): string | undefined {
  const headers = toAxiosHeaders(error.response?.headers);
  const value = headers.get(name);

  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.join(',');

  return String(value);
}

export function parseRetryAfterMs(value: unknown): number | null {
  if (!value) return null;

  const raw = Array.isArray(value) ? String(value[0]) : String(value);

  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

export function computeBackoffMs(
  error: AxiosError,
  retryCount: number,
  maxBackoffMs: number
): number {
  const retryAfterHeader = getResponseHeader(error, 'Retry-After');
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);

  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, maxBackoffMs);
  }

  const exponential = 300 * Math.pow(2, retryCount);
  const jitter = Math.random() * exponential * 0.3;

  return Math.min(exponential + jitter, maxBackoffMs);
}

export function delay(ms: number, signal?: GenericAbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new axios.CanceledError('Requete annulee pendant le retry'));
  }

  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      globalThis.clearTimeout(timer);
      cleanup();
      reject(new axios.CanceledError('Requete annulee pendant le retry'));
    };

    const cleanup = () => {
      signal?.removeEventListener?.('abort', onAbort);
    };

    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
