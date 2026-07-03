import { AxiosHeaders } from 'axios';
import type { AxiosHeaderValue } from 'axios';

export function toAxiosHeaders(headers: unknown): AxiosHeaders {
  if (headers instanceof AxiosHeaders || typeof headers === 'string') {
    return AxiosHeaders.from(headers);
  }

  const normalized = new AxiosHeaders();

  if (!headers || typeof headers !== 'object') {
    return normalized;
  }

  for (const [name, value] of Object.entries(
    headers as Record<string, AxiosHeaderValue | undefined>
  )) {
    if (value !== undefined) {
      normalized.set(name, value);
    }
  }

  return normalized;
}
