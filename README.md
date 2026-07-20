# ts-api-client

Reusable TypeScript API client based on Axios.

It includes:

- Axios client factory
- Bearer token injection
- Automatic access token refresh
- Single refresh request for multiple simultaneous 401 responses
- Retry with exponential backoff
- Retry-After support
- Request cancellation with AbortController
- Upload support with FormData
- Normalized API errors
- CRUD helper for REST resources
- Spring Boot pagination support
- Idempotency-Key support for safe POST/PATCH retries
- Absolute URL blocking by default
- Cross-origin Bearer token protection

---

## Installation

```bash
npm install @steven_ritchie/ts-api-client
```

For local development:

```bash
npm install ../ts-api-client
```

Or with a packed package:

```bash
cd ../ts-api-client
npm run build
npm pack
```

Then in your app:

```bash
npm install ../ts-api-client/steven_ritchie-ts-api-client-0.1.0.tgz
```

---

## Basic Usage

Create an API client:

```ts
import { createApiClient } from '@steven_ritchie/ts-api-client';

export const apiClient = createApiClient({
  baseURL: 'http://localhost:8080/api'
});
```

Then use it:

```ts
const users = await apiClient.get<User[]>('/users');

const product = await apiClient.post<Product>('/products', {
  name: 'Keyboard',
  unitPrice: 50000
});
```

---

## Public API Without Auth

For a public API, only provide `baseURL`:

```ts
export const publicApiClient = createApiClient({
  baseURL: 'https://api.example.com'
});
```

This client will not add an `Authorization` header, will not send cookies by
default, and will not call `/auth/refresh` after a `401`.

If you want to disable retries too:

```ts
export const publicApiClient = createApiClient({
  baseURL: 'https://api.example.com',
  maxRetries: 0
});
```

---

## Default Configuration

The client has default values:

```ts
requestTimeoutMs = 15000;
refreshTimeoutMs = 10000;
maxRetries = 2;
maxBackoffMs = 10000;
withCredentials = false;
```

Refresh is automatic only when `auth` or `refresh` is configured. A public
client created with only `baseURL` will not call `/auth/refresh` on `401`.

You can override them:

```ts
export const apiClient = createApiClient({
  baseURL: 'http://localhost:8080/api',

  requestTimeoutMs: 30000,
  refreshTimeoutMs: 15000,
  maxRetries: 3,
  maxBackoffMs: 20000
});
```

Meaning:

| Option | Default | Description |
|---|---:|---|
| `requestTimeoutMs` | `15000` | Timeout for normal API requests |
| `refreshTimeoutMs` | `10000` | Timeout for the refresh token request |
| `maxRetries` | `2` | Maximum automatic retries after the first failed request |
| `maxBackoffMs` | `10000` | Maximum delay before retrying a request |
| `withCredentials` | `false` | Send cookies and browser credentials |

Example:

```ts
maxRetries: 2
```

means:

```txt
1 initial request
2 retries maximum
```

So the API can be called up to 3 times in total.

---

## Auth Setup

This library does not depend on React, Zustand, Redux, or any framework.

You provide your own auth adapter:

```ts
import { createApiClient } from '@steven_ritchie/ts-api-client';
import { useAuthStore } from '../store/auth.store';

export const apiClient = createApiClient({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080/api',

  withCredentials: true,

  auth: {
    getAccessToken: () => {
      return useAuthStore.getState().accessToken;
    },

    setAccessToken: (accessToken, refreshResult) => {
      useAuthStore.getState().setAuth({
        accessToken,
        userId: refreshResult?.userId as string | undefined,
        role: refreshResult?.role as string | undefined
      });
    },

    clearAuth: () => {
      useAuthStore.getState().clearAuth();
    },

    onAuthExpired: () => {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  },

  refresh: {
    url: '/auth/refresh',
    method: 'POST',

    mapResponse: (data) => {
      const response = data as {
        accessToken: string;
        userId?: string;
        role?: string;
      };

      return {
        accessToken: response.accessToken,
        userId: response.userId,
        role: response.role
      };
    }
  }
});
```

---

## Recommended Refresh Token Strategy

Recommended production approach:

- Keep the access token in memory or app state.
- Store the refresh token in an HttpOnly cookie.
- The frontend should not read the refresh token.
- The backend refresh endpoint should read the cookie and return a new access token.

Example backend cookie:

```txt
Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh
```

Then the frontend refresh request only calls:

```ts
POST /auth/refresh
```

without manually sending the refresh token.

---

## Login Example

```ts
import { apiClient } from './client';
import { useAuthStore } from '../store/auth.store';

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  userId?: string;
  role?: string;
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const data = await apiClient.post<LoginResponse>('/auth/login', payload, {
    skipAuth: true,
    skipRefresh: true,
    retry: false
  });

  useAuthStore.getState().setAuth({
    accessToken: data.accessToken,
    userId: data.userId,
    role: data.role
  });

  return data;
}
```

---

## Logout Example

```ts
import { apiClient } from './client';
import { useAuthStore } from '../store/auth.store';

export async function logout(): Promise<void> {
  try {
    await apiClient.post<void>('/auth/logout', undefined, {
      skipRefresh: true,
      retry: false
    });
  } finally {
    useAuthStore.getState().clearAuth();
  }
}
```

---

## Bootstrap Auth On App Start

If your refresh token is stored in an HttpOnly cookie, you can restore the session when the app starts:

```ts
import { apiClient } from './client';
import { useAuthStore } from '../store/auth.store';

export async function bootstrapAuth(): Promise<void> {
  try {
    const data = await apiClient.post<{
      accessToken: string;
      userId?: string;
      role?: string;
    }>('/auth/refresh', undefined, {
      skipAuth: true,
      skipRefresh: true,
      retry: false
    });

    useAuthStore.getState().setAuth({
      accessToken: data.accessToken,
      userId: data.userId,
      role: data.role
    });
  } catch {
    useAuthStore.getState().clearAuth();
  }
}
```

Example in React:

```tsx
import { useEffect, useState } from 'react';
import { bootstrapAuth } from './api/auth.api';

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bootstrapAuth().finally(() => {
      setReady(true);
    });
  }, []);

  if (!ready) return <div>Loading...</div>;

  return <YourRoutes />;
}
```

---

## Handling Expired Auth

You can listen to the `auth:expired` event:

```ts
window.addEventListener('auth:expired', () => {
  console.log('Session expired');
});
```

In React, you can redirect the user to login:

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function AuthExpiredListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => {
      navigate('/login');
    };

    window.addEventListener('auth:expired', handler);

    return () => {
      window.removeEventListener('auth:expired', handler);
    };
  }, [navigate]);

  return null;
}
```

---

## CRUD Helper

Create a resource API:

```ts
import { createCrudApi } from '@steven_ritchie/ts-api-client';
import { apiClient } from './client';

export interface Product {
  id: string;
  name: string;
  unitPrice: number;
  stockQuantity: number;
}

export interface CreateProductDto {
  name: string;
  unitPrice: number;
  stockQuantity: number;
}

export interface UpdateProductDto {
  name: string;
  unitPrice: number;
  stockQuantity: number;
}

export const productApi = createCrudApi<Product, CreateProductDto, UpdateProductDto>(
  apiClient,
  '/products'
);
```

Use it:

```ts
const products = await productApi.list({
  page: 0,
  size: 20,
  sort: 'createdAt,desc'
});

const page = await productApi.listPage({
  page: 0,
  size: 20
});

const product = await productApi.getById('product-1');

const created = await productApi.create({
  name: 'Mouse',
  unitPrice: 30000,
  stockQuantity: 10
});

const updated = await productApi.update('product-1', {
  name: 'Gaming Mouse',
  unitPrice: 45000,
  stockQuantity: 15
});

const patched = await productApi.patch('product-1', {
  unitPrice: 50000
});

await productApi.remove('product-1');
```

---

## Spring Boot Pagination

The CRUD helper supports Spring Boot pagination:

```json
{
  "content": [],
  "totalElements": 0,
  "totalPages": 0,
  "number": 0,
  "size": 20
}
```

Use:

```ts
const page = await productApi.listPage({
  page: 0,
  size: 20,
  sort: 'createdAt,desc'
});

console.log(page.content);
console.log(page.totalElements);
```

If you only need the array:

```ts
const products = await productApi.list({
  page: 0,
  size: 20
});
```

`list()` returns only `content`.

---

## Normal Requests

```ts
const data = await apiClient.get<MyDto>('/endpoint');

const created = await apiClient.post<MyDto>('/endpoint', {
  name: 'Test'
});

const updated = await apiClient.put<MyDto>('/endpoint/1', {
  name: 'Updated'
});

const patched = await apiClient.patch<MyDto>('/endpoint/1', {
  name: 'Patched'
});

await apiClient.delete('/endpoint/1');
```

---

## Request Options

You can customize each request:

```ts
await apiClient.get('/public', {
  skipAuth: true
});
```

```ts
await apiClient.post('/auth/login', payload, {
  skipAuth: true,
  skipRefresh: true,
  retry: false
});
```

```ts
await apiClient.get('/reports', {
  retry: false
});
```

Available options:

| Option | Description |
|---|---|
| `skipAuth` | Do not add Bearer token |
| `skipRefresh` | Do not attempt refresh on 401 |
| `retry` | Enable or disable retry for this request |
| `retryUnsafe` | Allow retry on POST/PATCH |
| `idempotencyKey` | Add `Idempotency-Key` header |
| `allowAbsoluteUrls` | Allow this request to use an absolute URL |

---

## Absolute URLs And Token Safety

By default, requests must use relative paths such as `/products`.

Absolute URLs such as `https://other-api.example.com/products` are blocked by
default. This prevents accidentally sending authenticated API calls outside the
configured `baseURL`.

If you really need an absolute URL, enable it explicitly:

```ts
await apiClient.get('https://files.example.com/download', {
  allowAbsoluteUrls: true,
  skipAuth: true
});
```

Even when absolute URLs are allowed, the client only injects the Bearer token
for the same origin as `baseURL` by default. For a different origin, prefer a
separate client instance. If you intentionally need to send the Bearer token to
another origin, set `allowCrossOriginAuth: true` globally.

---

## Idempotency-Key

By default, POST and PATCH are not retried automatically.

This avoids duplicated actions such as:

- creating two sales
- creating two orders
- triggering the same action twice

For important business actions, you can use an idempotency key:

```ts
const sale = await apiClient.post<Sale>(
  '/sales',
  payload,
  {
    idempotencyKey: crypto.randomUUID()
  }
);
```

This adds:

```txt
Idempotency-Key: xxxxx
```

Your backend must store and handle this key correctly.

---

## Upload

```ts
const formData = new FormData();

formData.append('file', file);

const result = await apiClient.upload<{
  id: string;
  filename: string;
}>('/files', formData, {
  onProgress: (percent) => {
    console.log(`Upload: ${percent}%`);
  }
});
```

Important: the library does not manually force `Content-Type: multipart/form-data`.

The browser must set it automatically with the correct boundary.

---

## AbortController

```ts
import { createRequestController } from '@steven_ritchie/ts-api-client';

const controller = createRequestController();

const promise = apiClient.get('/products', {
  signal: controller.signal
});

controller.abort();

try {
  await promise;
} catch (error) {
  console.log(error);
}
```

---

## Error Handling

All API errors are normalized as `ApiException`.

```ts
import { isApiException } from '@steven_ritchie/ts-api-client';

try {
  await apiClient.get('/admin');
} catch (error) {
  if (isApiException(error)) {
    console.log(error.kind);
    console.log(error.status);
    console.log(error.message);
    console.log(error.fields);
  }
}
```

Possible `kind` values:

```ts
type ApiErrorKind =
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
```

Example:

```ts
try {
  await productApi.create({
    name: '',
    unitPrice: -1
  });
} catch (error) {
  if (isApiException(error)) {
    if (error.kind === 'validation') {
      console.log(error.fields);
    }

    if (error.kind === 'auth') {
      console.log('User must login again');
    }

    if (error.kind === 'server') {
      console.log('Server error');
    }
  }
}
```

---

## Advanced Configuration

```ts
export const apiClient = createApiClient({
  baseURL: 'http://localhost:8080/api',

  requestTimeoutMs: 30000,
  refreshTimeoutMs: 15000,

  maxRetries: 3,
  maxBackoffMs: 20000,

  retryableStatus: [408, 429, 500, 502, 503, 504],

  idempotentMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],

  withCredentials: true,
  allowAbsoluteUrls: false,
  allowCrossOriginAuth: false,

  logger: console,

  isOffline: () => {
    return navigator.onLine === false;
  },

  isAuthEndpoint: (url) => {
    return Boolean(
      url?.includes('/auth/login') ||
      url?.includes('/auth/register') ||
      url?.includes('/auth/refresh') ||
      url?.includes('/auth/logout')
    );
  }
});
```

---

## Recommended Project Structure

In your React app:

```txt
src/
|-- api/
|   |-- client.ts
|   |-- auth.api.ts
|   |-- product.api.ts
|   |-- sales.api.ts
|   `-- transfer.api.ts
|
|-- store/
|   `-- auth.store.ts
|
|-- pages/
|-- components/
`-- App.tsx
```

The library stays outside your app:

```txt
ts-api-client/
|-- src/
|-- test/
|-- package.json
`-- README.md
```

---

## Build

```bash
npm run build
```

---

## Test

```bash
npm run test
```

---

## Typecheck

```bash
npm run typecheck
```

---

## Publish

```bash
npm publish --access public
```

If you do not want to publish yet, keep it private:

```json
{
  "private": true
}
```

---

## License

MIT
