import axios, { AxiosError } from 'axios';
import type { ApiError, ApiErrorKind } from './types';

interface ApiErrorResponseBody {
  error?: string;
  message?: string;
  fields?: Record<string, string | string[]>;
  errors?: Record<string, string | string[]>;
}

export class ApiException extends Error {
  kind: ApiErrorKind;
  status: number;
  fields?: Record<string, string | string[]>;
  raw?: unknown;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiException';
    this.kind = apiError.kind;
    this.status = apiError.status;
    this.fields = apiError.fields;
    this.raw = apiError.raw;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classify(status: number): ApiErrorKind {
  if (status === 0) return 'network';
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';

  return 'unknown';
}

function extractMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (isRecord(data)) {
    const error = data.error;
    const message = data.message;

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function extractFields(data: unknown): Record<string, string | string[]> | undefined {
  if (!isRecord(data)) return undefined;

  const maybeBody = data as ApiErrorResponseBody;

  if (maybeBody.fields && isRecord(maybeBody.fields)) {
    return maybeBody.fields;
  }

  if (maybeBody.errors && isRecord(maybeBody.errors)) {
    return maybeBody.errors;
  }

  return undefined;
}

export function normalizeError(
  error: unknown,
  isOffline?: () => boolean
): ApiError {
  if (error instanceof ApiException) {
    return {
      kind: error.kind,
      status: error.status,
      message: error.message,
      fields: error.fields,
      raw: error.raw
    };
  }

  if (axios.isCancel(error)) {
    return {
      kind: 'cancelled',
      status: 0,
      message: 'Requête annulée',
      raw: error
    };
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    if (axiosError.code === 'ECONNABORTED') {
      return {
        kind: 'timeout',
        status: 0,
        message: 'Le serveur met trop de temps à répondre',
        raw: error
      };
    }

    if (!axiosError.response) {
      const offline = isOffline?.() ?? false;

      return {
        kind: offline ? 'offline' : 'network',
        status: 0,
        message: offline
          ? 'Vous semblez être hors ligne'
          : 'Impossible de joindre le serveur',
        raw: error
      };
    }

    const status = axiosError.response.status;
    const data = axiosError.response.data;

    return {
      kind: classify(status),
      status,
      message: extractMessage(data, 'Une erreur est survenue'),
      fields: extractFields(data),
      raw: data
    };
  }

  return {
    kind: 'unknown',
    status: 0,
    message: 'Erreur inconnue',
    raw: error
  };
}

export function toApiException(
  error: unknown,
  isOffline?: () => boolean
): ApiException {
  if (error instanceof ApiException) return error;

  return new ApiException(normalizeError(error, isOffline));
}

export function isApiException(error: unknown): error is ApiException {
  return error instanceof ApiException;
}