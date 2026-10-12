import { describe, it, expect } from 'vitest';
import { Endpoint } from './endpoint.entity';
import { UrlVo } from '../value-objects/url.vo';
import { HttpMethodVo } from '../value-objects/http-method.vo';

describe('Endpoint Entity', () => {
  it('debe instanciarse correctamente con datos válidos', () => {
    const endpoint = new Endpoint({
      id: 'ep-1',
      name: 'API Users',
      url: new UrlVo('https://api.example.com/users'),
      method: new HttpMethodVo('GET'),
      headers: { 'Authorization': 'Bearer test' },
      intervalSeconds: 30,
      timeoutMs: 5000,
      expectedStatusCodes: [200],
      assertions: [],
      isActive: true,
      tags: ['production', 'api'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(endpoint.id).toBe('ep-1');
    expect(endpoint.name).toBe('API Users');
    expect(endpoint.url.toString()).toBe('https://api.example.com/users');
    expect(endpoint.method.value).toBe('GET');
    expect(endpoint.isActive).toBe(true);
  });

  it('debe arrojar error si el nombre del endpoint está vacío', () => {
    expect(() => {
      new Endpoint({
        id: 'ep-2',
        name: '   ',
        url: new UrlVo('https://api.example.com'),
        method: new HttpMethodVo('GET'),
        intervalSeconds: 30,
        timeoutMs: 5000,
        expectedStatusCodes: [200],
        assertions: [],
        isActive: true,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }).toThrow('El nombre del endpoint no puede estar vacío');
  });
});
