import type {
  ApiClient,
  ApiRequestConfig,
  CrudApi,
  EntityId,
  ListQueryParams,
  PageResponse
} from './types';

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim().replace(/^\/+|\/+$/g, '');

  if (!trimmed) {
    throw new Error('createCrudApi: basePath ne peut pas etre vide');
  }

  return `/${trimmed}`;
}

function isPageResponse<T>(value: unknown): value is PageResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PageResponse<T>).content)
  );
}

export function createCrudApi<T, CreateDto = Partial<T>, UpdateDto = Partial<T>>(
  client: ApiClient,
  basePath: string
): CrudApi<T, CreateDto, UpdateDto> {
  const base = normalizeBasePath(basePath);

  const withId = (id: EntityId) => {
    if (id === null || id === undefined || id === '') {
      throw new Error('createCrudApi: id invalide');
    }

    return `${base}/${encodeURIComponent(String(id))}`;
  };

  return {
    list: async (params?: ListQueryParams, config?: ApiRequestConfig) => {
      const data = await client.get<T[] | PageResponse<T>>(base, {
        ...config,
        params
      });

      if (Array.isArray(data)) {
        return data;
      }

      if (isPageResponse<T>(data)) {
        return data.content;
      }

      throw new Error(`Reponse invalide pour list() sur ${base}`);
    },

    listPage: async (params?: ListQueryParams, config?: ApiRequestConfig) => {
      const data = await client.get<PageResponse<T>>(base, {
        ...config,
        params
      });

      if (!isPageResponse<T>(data)) {
        throw new Error(`Reponse invalide pour listPage() sur ${base}`);
      }

      return data;
    },

    getById: async (id, config) => {
      return client.get<T>(withId(id), config);
    },

    create: async (payload, config) => {
      return client.post<T>(base, payload, config);
    },

    update: async (id, payload, config) => {
      return client.put<T>(withId(id), payload, config);
    },

    patch: async (id, payload, config) => {
      return client.patch<T>(withId(id), payload, config);
    },

    remove: async (id, config) => {
      await client.delete<void>(withId(id), config);
    }
  };
}
