import axios, {
  AxiosError,
  AxiosRequestConfig,
  InternalAxiosRequestConfig
} from 'axios';

import { computeBackoffMs, delay } from './retry';
import { toApiException } from './errors';
import { toAxiosHeaders } from './headers';

import type {
  ApiClient,
  ApiClientOptions,
  ApiRequestConfig,
  RefreshResult,
  UploadConfig
} from './types';

type InternalApiRequestConfig = InternalAxiosRequestConfig & ApiRequestConfig & {
  _retry?: boolean;
  _retryCount?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_REFRESH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_BACKOFF_MS = 10000;

const DEFAULT_RETRYABLE_STATUS = [408, 429, 502, 503, 504];
const DEFAULT_IDEMPOTENT_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

function normalizeBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('createApiClient: baseURL must not be empty');
  }

  return trimmed;
}

function isAbsoluteUrl(url: string | undefined): boolean {
  return Boolean(
    url &&
      (/^[a-z][a-z\d+\-.]*:\/\//i.test(url) || url.startsWith('//'))
  );
}

function getOrigin(url: string | undefined, baseURL: string): string | null {
  const fallbackOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  try {
    const base = new URL(baseURL, fallbackOrigin);
    return new URL(url ?? '', base).origin;
  } catch {
    return null;
  }
}

function isSameApiOrigin(url: string | undefined, baseURL: string): boolean {
  const baseOrigin = getOrigin(undefined, baseURL);
  const targetOrigin = getOrigin(url, baseURL);

  return Boolean(baseOrigin && targetOrigin && baseOrigin === targetOrigin);
}

function assertAbsoluteUrlAllowed(
  url: string | undefined,
  allowAbsoluteUrls: boolean
): void {
  if (!allowAbsoluteUrls && isAbsoluteUrl(url)) {
    throw new Error('ABSOLUTE_URL_NOT_ALLOWED');
  }
}

function defaultIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function setHeader(
  config: InternalAxiosRequestConfig | AxiosRequestConfig,
  name: string,
  value: string
): void {
  const headers = toAxiosHeaders(config.headers);
  headers.set(name, value);
  config.headers = headers;
}

function getPathname(url: string | undefined, baseURL: string): string {
  if (!url) return '';

  try {
    return new URL(url, baseURL).pathname;
  } catch {
    return url;
  }
}

function defaultIsAuthEndpoint(url: string | undefined, baseURL: string): boolean {
  const pathname = getPathname(url, baseURL);

  return (
    pathname.endsWith('/auth/login') ||
    pathname.endsWith('/auth/register') ||
    pathname.endsWith('/auth/refresh') ||
    pathname.endsWith('/auth/logout')
  );
}

function defaultMapRefreshResponse(data: unknown): RefreshResult {
  if (
    typeof data === 'object' &&
    data !== null &&
    'accessToken' in data &&
    typeof (data as { accessToken: unknown }).accessToken === 'string'
  ) {
    return data as RefreshResult;
  }

  throw new Error('INVALID_REFRESH_RESPONSE');
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseURL = normalizeBaseUrl(options.baseURL);

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  const retryableStatus = new Set(options.retryableStatus ?? DEFAULT_RETRYABLE_STATUS);
  const idempotentMethods = new Set(
    (options.idempotentMethods ?? DEFAULT_IDEMPOTENT_METHODS).map((method) =>
      method.toUpperCase()
    )
  );
  const allowAbsoluteUrls = options.allowAbsoluteUrls ?? false;
  const allowCrossOriginAuth = options.allowCrossOriginAuth ?? false;

  const isOffline = options.isOffline ?? defaultIsOffline;

  const isAuthEndpoint = (url?: string) => {
    return options.isAuthEndpoint?.(url) ?? defaultIsAuthEndpoint(url, baseURL);
  };

  const axiosInstance = axios.create({
    baseURL,
    timeout: requestTimeoutMs,
    withCredentials: options.withCredentials ?? true,
    allowAbsoluteUrls,
    headers: {
      Accept: 'application/json'
    },
    paramsSerializer: {
      indexes: null
    },
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN'
  });

  axiosInstance.interceptors.request.use(async (config: InternalApiRequestConfig) => {
    const requestAllowsAbsoluteUrl =
      config.allowAbsoluteUrls ?? allowAbsoluteUrls;

    assertAbsoluteUrlAllowed(config.url, requestAllowsAbsoluteUrl);

    const token = await options.auth?.getAccessToken?.();

    const canAttachAuth =
      allowCrossOriginAuth || isSameApiOrigin(config.url, baseURL);

    if (!config.skipAuth && token && canAttachAuth) {
      setHeader(config, 'Authorization', `Bearer ${token}`);
    }

    if (config.idempotencyKey) {
      setHeader(config, 'Idempotency-Key', config.idempotencyKey);
    }

    return config;
  });

  let refreshPromise: Promise<string> | null = null;

  async function performRefresh(): Promise<string> {
    const refreshConfig = options.refresh;

    if (refreshConfig?.enabled === false) {
      throw new Error('REFRESH_DISABLED');
    }

    const url = refreshConfig?.url ?? '/auth/refresh';
    const method = refreshConfig?.method ?? 'POST';
    const body = await refreshConfig?.getBody?.();
    const refreshAllowsAbsoluteUrl =
      refreshConfig?.allowAbsoluteUrls ?? allowAbsoluteUrls;

    assertAbsoluteUrlAllowed(url, refreshAllowsAbsoluteUrl);

    const response = await axios.request({
      baseURL,
      url,
      method,
      data: body,
      timeout: refreshConfig?.timeoutMs ?? refreshTimeoutMs,
      withCredentials: options.withCredentials ?? true,
      allowAbsoluteUrls: refreshAllowsAbsoluteUrl,
      headers: {
        Accept: 'application/json',
        ...refreshConfig?.headers
      }
    });

    const result = refreshConfig?.mapResponse
      ? refreshConfig.mapResponse(response.data)
      : defaultMapRefreshResponse(response.data);

    if (!result.accessToken) {
      throw new Error('INVALID_REFRESH_RESPONSE');
    }

    await options.auth?.setAccessToken?.(result.accessToken, result);

    return result.accessToken;
  }

  function getOrCreateRefreshPromise(): Promise<string> {
    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    return refreshPromise;
  }

  function shouldRetry(error: AxiosError, config: InternalApiRequestConfig): boolean {
    if (config.retry === false) return false;

    if (axios.isCancel(error)) return false;
    if (config.signal?.aborted) return false;
    if (isOffline()) return false;
    if (isAuthEndpoint(config.url)) return false;

    const retryCount = config._retryCount ?? 0;
    if (retryCount >= maxRetries) return false;

    const method = config.method?.toUpperCase() ?? 'GET';
    const isIdempotent = idempotentMethods.has(method);

    const isUnsafeButExplicitlyAllowed =
      config.retryUnsafe === true || Boolean(config.idempotencyKey);

    if (!isIdempotent && !isUnsafeButExplicitlyAllowed) {
      return false;
    }

    const status = error.response?.status ?? 0;

    return status === 0 || retryableStatus.has(status);
  }

  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (axios.isCancel(error)) {
        return Promise.reject(error);
      }

      const originalRequest = error.config as InternalApiRequestConfig | undefined;

      if (!originalRequest) {
        return Promise.reject(error);
      }

      const status = error.response?.status;

      if (
        status === 401 &&
        !originalRequest._retry &&
        !originalRequest.skipRefresh &&
        !isAuthEndpoint(originalRequest.url)
      ) {
        originalRequest._retry = true;

        try {
          const newToken = await getOrCreateRefreshPromise();
          setHeader(originalRequest, 'Authorization', `Bearer ${newToken}`);

          return axiosInstance(originalRequest);
        } catch (refreshError) {
          options.logger?.warn?.('API refresh failed', refreshError);

          await options.auth?.clearAuth?.();
          await options.auth?.onAuthExpired?.();

          return Promise.reject(error);
        }
      }

      if (shouldRetry(error, originalRequest)) {
        const retryCount = originalRequest._retryCount ?? 0;
        originalRequest._retryCount = retryCount + 1;

        const backoffMs = computeBackoffMs(error, retryCount, maxBackoffMs);

        await delay(backoffMs, originalRequest.signal);

        return axiosInstance(originalRequest);
      }

      return Promise.reject(error);
    }
  );

  async function request<T>(config: ApiRequestConfig): Promise<T> {
    try {
      const response = await axiosInstance.request<T>(config);
      return response.data;
    } catch (error) {
      throw toApiException(error, isOffline);
    }
  }

  return {
    raw: axiosInstance,

    request,

    get: <T>(url: string, config?: ApiRequestConfig): Promise<T> => {
      return request<T>({
        ...config,
        method: 'GET',
        url
      });
    },

    post: <T>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<T> => {
      return request<T>({
        ...config,
        method: 'POST',
        url,
        data: body
      });
    },

    put: <T>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<T> => {
      return request<T>({
        ...config,
        method: 'PUT',
        url,
        data: body
      });
    },

    patch: <T>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<T> => {
      return request<T>({
        ...config,
        method: 'PATCH',
        url,
        data: body
      });
    },

    delete: <T = void>(url: string, config?: ApiRequestConfig): Promise<T> => {
      return request<T>({
        ...config,
        method: 'DELETE',
        url
      });
    },

    upload: async <T>(
      url: string,
      formData: FormData,
      config?: UploadConfig
    ): Promise<T> => {
      const { onProgress, headers, ...restConfig } = config ?? {};

      const cleanHeaders = toAxiosHeaders(headers);

      cleanHeaders.delete('Content-Type');
      cleanHeaders.delete('content-type');

      return request<T>({
        ...restConfig,
        method: 'POST',
        url,
        data: formData,
        headers: cleanHeaders,
        onUploadProgress: onProgress
          ? (event) => {
              if (!event.total) {
                onProgress(0);
                return;
              }

              const percent = Math.round((event.loaded * 100) / event.total);
              onProgress(percent);
            }
          : undefined
      });
    }
  };
}

export function createRequestController(): AbortController {
  return new AbortController();
}
