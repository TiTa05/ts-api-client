import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiClient,
  createCrudApi,
  type ApiClient,
  type PageResponse
} from '../src';

interface Product {
  id: string;
  name: string;
  unitPrice: number;
}

interface CreateProductDto {
  name: string;
  unitPrice: number;
}

interface UpdateProductDto {
  name: string;
  unitPrice: number;
}

let apiClient: ApiClient;
let apiMock: MockAdapter;

beforeEach(() => {
  apiClient = createApiClient({
    baseURL: 'http://localhost:8080/api'
  });

  apiMock = new MockAdapter(apiClient.raw, {
    delayResponse: 0
  });
});

afterEach(() => {
  apiMock.restore();
});

describe('createCrudApi', () => {
  it('refuse un basePath vide', () => {
    expect(() => createCrudApi<Product>(apiClient, '')).toThrow(
      'createCrudApi: basePath ne peut pas etre vide'
    );
  });

  it('normalise les slashs du basePath', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products/');

    apiMock.onGet('/products').reply(200, [
      {
        id: 'p1',
        name: 'Product 1',
        unitPrice: 1000
      }
    ]);

    const result = await productApi.list();

    expect(result).toEqual([
      {
        id: 'p1',
        name: 'Product 1',
        unitPrice: 1000
      }
    ]);
  });

  it('list retourne directement un tableau si le backend renvoie un tableau', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    apiMock.onGet('/products').reply(200, [
      {
        id: 'p1',
        name: 'Product 1',
        unitPrice: 1000
      },
      {
        id: 'p2',
        name: 'Product 2',
        unitPrice: 2000
      }
    ]);

    const result = await productApi.list();

    expect(result).toEqual([
      {
        id: 'p1',
        name: 'Product 1',
        unitPrice: 1000
      },
      {
        id: 'p2',
        name: 'Product 2',
        unitPrice: 2000
      }
    ]);
  });

  it('list retourne content si le backend renvoie une pagination Spring', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    const page: PageResponse<Product> = {
      content: [
        {
          id: 'p1',
          name: 'Product 1',
          unitPrice: 1000
        }
      ],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
      first: true,
      last: true,
      empty: false
    };

    apiMock.onGet('/products').reply(200, page);

    const result = await productApi.list({
      page: 0,
      size: 20,
      sort: 'createdAt,desc'
    });

    expect(result).toEqual(page.content);
    expect(apiMock.history.get[0].params).toEqual({
      page: 0,
      size: 20,
      sort: 'createdAt,desc'
    });
  });

  it('listPage retourne la page complete', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    const page: PageResponse<Product> = {
      content: [
        {
          id: 'p1',
          name: 'Product 1',
          unitPrice: 1000
        }
      ],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20
    };

    apiMock.onGet('/products').reply(200, page);

    const result = await productApi.listPage({
      page: 0,
      size: 20
    });

    expect(result).toEqual(page);
  });

  it('listPage echoue si le backend renvoie un simple tableau', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    apiMock.onGet('/products').reply(200, [
      {
        id: 'p1',
        name: 'Product 1',
        unitPrice: 1000
      }
    ]);

    await expect(productApi.listPage()).rejects.toThrow(
      'Reponse invalide pour listPage() sur /products'
    );
  });

  it('getById encode correctement les IDs', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    apiMock.onGet('/products/id%20avec%20espace').reply(200, {
      id: 'id avec espace',
      name: 'Special product',
      unitPrice: 5000
    });

    const result = await productApi.getById('id avec espace');

    expect(result).toEqual({
      id: 'id avec espace',
      name: 'Special product',
      unitPrice: 5000
    });
  });

  it('getById refuse un ID vide', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    await expect(productApi.getById('')).rejects.toThrow(
      'createCrudApi: id invalide'
    );
  });

  it('create appelle POST sur la collection', async () => {
    const productApi = createCrudApi<Product, CreateProductDto, UpdateProductDto>(
      apiClient,
      '/products'
    );

    apiMock.onPost('/products').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({
        name: 'Product 1',
        unitPrice: 1000
      });

      return [
        201,
        {
          id: 'p1',
          name: 'Product 1',
          unitPrice: 1000
        }
      ];
    });

    const result = await productApi.create({
      name: 'Product 1',
      unitPrice: 1000
    });

    expect(result).toEqual({
      id: 'p1',
      name: 'Product 1',
      unitPrice: 1000
    });
  });

  it('update appelle PUT sur /resource/:id', async () => {
    const productApi = createCrudApi<Product, CreateProductDto, UpdateProductDto>(
      apiClient,
      '/products'
    );

    apiMock.onPut('/products/p1').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({
        name: 'Updated product',
        unitPrice: 2000
      });

      return [
        200,
        {
          id: 'p1',
          name: 'Updated product',
          unitPrice: 2000
        }
      ];
    });

    const result = await productApi.update('p1', {
      name: 'Updated product',
      unitPrice: 2000
    });

    expect(result).toEqual({
      id: 'p1',
      name: 'Updated product',
      unitPrice: 2000
    });
  });

  it('patch appelle PATCH sur /resource/:id', async () => {
    const productApi = createCrudApi<Product, CreateProductDto, UpdateProductDto>(
      apiClient,
      '/products'
    );

    apiMock.onPatch('/products/p1').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({
        unitPrice: 3000
      });

      return [
        200,
        {
          id: 'p1',
          name: 'Product 1',
          unitPrice: 3000
        }
      ];
    });

    const result = await productApi.patch('p1', {
      unitPrice: 3000
    });

    expect(result).toEqual({
      id: 'p1',
      name: 'Product 1',
      unitPrice: 3000
    });
  });

  it('remove appelle DELETE sur /resource/:id', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    apiMock.onDelete('/products/p1').reply(204);

    await expect(productApi.remove('p1')).resolves.toBeUndefined();

    expect(apiMock.history.delete).toHaveLength(1);
  });

  it('transmet la config Axios a list', async () => {
    const productApi = createCrudApi<Product>(apiClient, '/products');

    apiMock.onGet('/products').reply((config) => {
      expect(config.params).toEqual({
        page: 1,
        size: 10
      });

      expect(config.headers?.['X-Test']).toBe('hello');

      return [
        200,
        {
          content: [],
          totalElements: 0,
          totalPages: 0,
          number: 1,
          size: 10
        }
      ];
    });

    const result = await productApi.list(
      {
        page: 1,
        size: 10
      },
      {
        headers: {
          'X-Test': 'hello'
        }
      }
    );

    expect(result).toEqual([]);
  });
});
