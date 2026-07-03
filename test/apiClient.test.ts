import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createApiClient,
  isApiException,
  type ApiClient,
  type ApiRequestConfig
} from '../src';

let apiClient: ApiClient;
let apiMock: MockAdapter;
let refreshMock: MockAdapter;
let accessToken: string | null;

function getHeader(config: ApiRequestConfig, name: string): string | undefined {
  const headers = config.headers as
    | (Record<string, unknown> & { get?: (name: string) => unknown })
    | undefined;

  const value =
    headers?.get?.(name) ??
    headers?.[name] ??
    headers?.[name.toLowerCase()];

  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.join(',');

  return String(value);
}

function createClient(options: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  accessToken = 'initial-token';

  apiClient = createApiClient({
    baseURL: 'http://localhost:8080/api',
    maxBackoffMs: 0,
    auth: {
      getAccessToken: () => accessToken,
      setAccessToken: (token) => {
        accessToken = token;
      },
      clearAuth: () => {
        accessToken = null;
      }
    },
    ...options
  });

  apiMock = new MockAdapter(apiClient.raw, {
    delayResponse: 0
  });
}

beforeEach(() => {
  refreshMock = new MockAdapter(axios, {
    delayResponse: 0
  });

  createClient();
});

afterEach(() => {
  apiMock.restore();
  refreshMock.restore();
});

describe('createApiClient', () => {
  it('injecte le Bearer token sur les requetes de meme origine', async () => {
    apiMock.onGet('/me').reply((config) => [
      200,
      {
        authorization: getHeader(config, 'Authorization')
      }
    ]);

    const result = await apiClient.get<{ authorization?: string }>('/me');

    expect(result.authorization).toBe('Bearer initial-token');
  });

  it('respecte skipAuth', async () => {
    apiMock.onGet('/public').reply((config) => [
      200,
      {
        authorization: getHeader(config, 'Authorization') ?? null
      }
    ]);

    const result = await apiClient.get<{ authorization: string | null }>(
      '/public',
      {
        skipAuth: true
      }
    );

    expect(result.authorization).toBeNull();
  });

  it('desactive withCredentials par defaut', () => {
    apiMock.restore();

    apiClient = createApiClient({
      baseURL: 'http://localhost:8080/api'
    });

    apiMock = new MockAdapter(apiClient.raw, {
      delayResponse: 0
    });

    expect(apiClient.raw.defaults.withCredentials).toBe(false);
  });

  it('ne tente pas de refresh implicite pour un client public sans auth', async () => {
    apiMock.restore();

    apiClient = createApiClient({
      baseURL: 'http://localhost:8080/api',
      maxBackoffMs: 0
    });

    apiMock = new MockAdapter(apiClient.raw, {
      delayResponse: 0
    });

    apiMock.onGet('/public/protected').reply(401, {
      message: 'Unauthorized'
    });
    refreshMock.onPost('/auth/refresh').reply(200, {
      accessToken: 'unexpected-token'
    });

    await expect(apiClient.get('/public/protected')).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      message: 'Unauthorized'
    });

    expect(refreshMock.history.post).toHaveLength(0);
  });

  it('respecte refresh.enabled false meme avec un auth adapter', async () => {
    const clearAuth = vi.fn();
    const onAuthExpired = vi.fn();

    createClient({
      auth: {
        getAccessToken: () => accessToken,
        clearAuth,
        onAuthExpired
      },
      refresh: {
        enabled: false
      }
    });

    apiMock.onGet('/profile').reply(401, {
      message: 'expired'
    });
    refreshMock.onPost('/auth/refresh').reply(200, {
      accessToken: 'unexpected-token'
    });

    await expect(apiClient.get('/profile')).rejects.toMatchObject({
      kind: 'auth',
      status: 401
    });

    expect(refreshMock.history.post).toHaveLength(0);
    expect(clearAuth).not.toHaveBeenCalled();
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('bloque les URLs absolues par defaut', async () => {
    await expect(
      apiClient.get('https://files.example.test/download')
    ).rejects.toMatchObject({
      message: 'ABSOLUTE_URL_NOT_ALLOWED'
    });
  });

  it('autorise une URL absolue explicite sans envoyer le token cross-origin', async () => {
    createClient({
      allowAbsoluteUrls: true
    });

    apiMock.onGet('https://files.example.test/download').reply((config) => [
      200,
      {
        authorization: getHeader(config, 'Authorization') ?? null
      }
    ]);

    const result = await apiClient.get<{ authorization: string | null }>(
      'https://files.example.test/download'
    );

    expect(result.authorization).toBeNull();
  });

  it('permet explicitement le Bearer token cross-origin', async () => {
    createClient({
      allowAbsoluteUrls: true,
      allowCrossOriginAuth: true
    });

    apiMock.onGet('https://partner.example.test/resource').reply((config) => [
      200,
      {
        authorization: getHeader(config, 'Authorization')
      }
    ]);

    const result = await apiClient.get<{ authorization?: string }>(
      'https://partner.example.test/resource'
    );

    expect(result.authorization).toBe('Bearer initial-token');
  });

  it('refresh le token apres un 401 et relance la requete initiale', async () => {
    accessToken = 'expired-token';

    apiMock
      .onGet('/profile')
      .replyOnce((config) => {
        expect(getHeader(config, 'Authorization')).toBe('Bearer expired-token');
        return [401, { message: 'expired' }];
      })
      .onGet('/profile')
      .reply((config) => [
        200,
        {
          authorization: getHeader(config, 'Authorization')
        }
      ]);

    refreshMock.onPost('/auth/refresh').reply(200, {
      accessToken: 'fresh-token'
    });

    const result = await apiClient.get<{ authorization?: string }>('/profile');

    expect(result.authorization).toBe('Bearer fresh-token');
    expect(accessToken).toBe('fresh-token');
    expect(refreshMock.history.post).toHaveLength(1);
  });

  it('partage une seule requete refresh pour plusieurs 401 simultanes', async () => {
    accessToken = 'expired-token';
    let protectedAttempts = 0;
    let refreshCalls = 0;

    apiMock.onGet('/profile').reply((config) => {
      protectedAttempts += 1;

      if (protectedAttempts <= 2) {
        return [401, { message: 'expired' }];
      }

      return [
        200,
        {
          authorization: getHeader(config, 'Authorization')
        }
      ];
    });

    refreshMock.onPost('/auth/refresh').reply(
      () =>
        new Promise((resolve) => {
          refreshCalls += 1;
          setTimeout(() => {
            resolve([200, { accessToken: 'fresh-token' }]);
          }, 10);
        })
    );

    const [first, second] = await Promise.all([
      apiClient.get<{ authorization?: string }>('/profile'),
      apiClient.get<{ authorization?: string }>('/profile')
    ]);

    expect(first.authorization).toBe('Bearer fresh-token');
    expect(second.authorization).toBe('Bearer fresh-token');
    expect(refreshCalls).toBe(1);
    expect(protectedAttempts).toBe(4);
  });

  it('nettoie la session quand le refresh echoue', async () => {
    const clearAuth = vi.fn(() => {
      accessToken = null;
    });
    const onAuthExpired = vi.fn();

    createClient({
      auth: {
        getAccessToken: () => accessToken,
        setAccessToken: (token) => {
          accessToken = token;
        },
        clearAuth,
        onAuthExpired
      }
    });

    apiMock.onGet('/profile').reply(401, {
      message: 'expired'
    });
    refreshMock.onPost('/auth/refresh').reply(401, {
      message: 'refresh expired'
    });

    await expect(apiClient.get('/profile')).rejects.toMatchObject({
      kind: 'auth',
      status: 401
    });

    expect(clearAuth).toHaveBeenCalledTimes(1);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(accessToken).toBeNull();
  });

  it('retry automatiquement une requete GET temporairement indisponible', async () => {
    apiMock
      .onGet('/reports')
      .replyOnce(503, { message: 'try again' })
      .onGet('/reports')
      .reply(200, { ok: true });

    const result = await apiClient.get<{ ok: boolean }>('/reports');

    expect(result).toEqual({ ok: true });
    expect(apiMock.history.get).toHaveLength(2);
  });

  it('ne retry pas POST sans idempotencyKey ou retryUnsafe', async () => {
    apiMock
      .onPost('/orders')
      .replyOnce(503, { message: 'try again' })
      .onPost('/orders')
      .reply(200, { ok: true });

    await expect(apiClient.post('/orders', { total: 100 })).rejects.toMatchObject({
      kind: 'server',
      status: 503
    });

    expect(apiMock.history.post).toHaveLength(1);
  });

  it('retry POST quand une idempotencyKey est fournie', async () => {
    apiMock
      .onPost('/orders')
      .replyOnce(503, { message: 'try again' })
      .onPost('/orders')
      .reply((config) => [
        200,
        {
          idempotencyKey: getHeader(config, 'Idempotency-Key')
        }
      ]);

    const result = await apiClient.post<{ idempotencyKey?: string }>(
      '/orders',
      { total: 100 },
      {
        idempotencyKey: 'order-123'
      }
    );

    expect(result.idempotencyKey).toBe('order-123');
    expect(apiMock.history.post).toHaveLength(2);
  });

  it('normalise les erreurs de validation', async () => {
    apiMock.onPost('/products').reply(422, {
      message: 'Invalid product',
      fields: {
        name: 'Required'
      }
    });

    try {
      await apiClient.post('/products', { name: '' });
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(isApiException(error)).toBe(true);

      if (isApiException(error)) {
        expect(error.kind).toBe('validation');
        expect(error.status).toBe(422);
        expect(error.message).toBe('Invalid product');
        expect(error.fields).toEqual({
          name: 'Required'
        });
      }
    }
  });

  it('supprime Content-Type manuel pour les uploads FormData', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['hello']), 'hello.txt');

    apiMock.onPost('/files').reply((config) => [
      200,
      {
        contentType: getHeader(config, 'Content-Type') ?? null
      }
    ]);

    const result = await apiClient.upload<{ contentType: string | null }>(
      '/files',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    expect(result.contentType).not.toBe('multipart/form-data');
  });
});
