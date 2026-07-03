import type { AxiosInstance, AxiosRequestConfig } from 'axios';

export type ApiErrorKind =
  | 'network'
  | 'offline'
  | 'timeout'
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'server'
  | 'cancelled'
  | 'unknown';

export interface ApiError {
  kind: ApiErrorKind;
  status: number;
  message: string;
  fields?: Record<string, string | string[]>;
  raw?: unknown;
}

export interface ApiRequestConfig<D = unknown> extends AxiosRequestConfig<D> {
  skipAuth?: boolean;
  skipRefresh?: boolean;
  retry?: boolean;
  retryUnsafe?: boolean;
  idempotencyKey?: string;
}

export interface RefreshResult {
  accessToken: string;
  [key: string]: unknown;
}

export interface ApiAuthAdapter {
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;

  setAccessToken?: (
    accessToken: string,
    refreshResult?: RefreshResult
  ) => void | Promise<void>;

  clearAuth?: () => void | Promise<void>;

  onAuthExpired?: () => void | Promise<void>;
}

export interface ApiRefreshConfig {
  enabled?: boolean;
  url?: string;
  method?: 'POST' | 'GET';
  timeoutMs?: number;
  allowAbsoluteUrls?: boolean;
  headers?: Record<string, string>;
  getBody?: () => unknown | Promise<unknown>;
  mapResponse?: (data: unknown) => RefreshResult;
}

export interface ApiLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface ApiClientOptions {
  baseURL: string;

  requestTimeoutMs?: number;
  refreshTimeoutMs?: number;

  maxRetries?: number;
  maxBackoffMs?: number;

  retryableStatus?: number[];
  idempotentMethods?: string[];

  withCredentials?: boolean;
  allowAbsoluteUrls?: boolean;
  allowCrossOriginAuth?: boolean;

  auth?: ApiAuthAdapter;
  refresh?: ApiRefreshConfig;

  logger?: ApiLogger;

  isOffline?: () => boolean;
  isAuthEndpoint?: (url?: string) => boolean;
}

export interface UploadConfig extends ApiRequestConfig {
  onProgress?: (percent: number) => void;
}

export interface ApiClient {
  request: <T>(config: ApiRequestConfig) => Promise<T>;

  get: <T>(url: string, config?: ApiRequestConfig) => Promise<T>;

  post: <T>(url: string, body?: unknown, config?: ApiRequestConfig) => Promise<T>;

  put: <T>(url: string, body?: unknown, config?: ApiRequestConfig) => Promise<T>;

  patch: <T>(url: string, body?: unknown, config?: ApiRequestConfig) => Promise<T>;

  delete: <T = void>(url: string, config?: ApiRequestConfig) => Promise<T>;

  upload: <T>(
    url: string,
    formData: FormData,
    config?: UploadConfig
  ) => Promise<T>;

  raw: AxiosInstance;
}

export type EntityId = string | number;

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first?: boolean;
  last?: boolean;
  empty?: boolean;
}

export interface ListQueryParams {
  page?: number;
  size?: number;
  sort?: string;
  [key: string]: unknown;
}

export interface CrudApi<T, CreateDto = Partial<T>, UpdateDto = Partial<T>> {
  list: (params?: ListQueryParams, config?: ApiRequestConfig) => Promise<T[]>;

  listPage: (
    params?: ListQueryParams,
    config?: ApiRequestConfig
  ) => Promise<PageResponse<T>>;

  getById: (id: EntityId, config?: ApiRequestConfig) => Promise<T>;

  create: (
    payload: CreateDto,
    config?: ApiRequestConfig
  ) => Promise<T>;

  update: (
    id: EntityId,
    payload: UpdateDto,
    config?: ApiRequestConfig
  ) => Promise<T>;

  patch: (
    id: EntityId,
    payload: Partial<UpdateDto>,
    config?: ApiRequestConfig
  ) => Promise<T>;

  remove: (
    id: EntityId,
    config?: ApiRequestConfig
  ) => Promise<void>;
}
