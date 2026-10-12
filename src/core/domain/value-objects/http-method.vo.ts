export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export class HttpMethodVo {
  private static readonly VALID_METHODS: readonly HttpMethod[] = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ];

  public readonly value: HttpMethod;

  constructor(method: string) {
    const normalized = method.toUpperCase() as HttpMethod;
    if (!HttpMethodVo.VALID_METHODS.includes(normalized)) {
      throw new Error(`Método HTTP inválido: "${method}". Permitidos: ${HttpMethodVo.VALID_METHODS.join(', ')}`);
    }
    this.value = normalized;
  }

  public static create(method: string = 'GET'): HttpMethodVo {
    return new HttpMethodVo(method);
  }

  public equals(other: HttpMethodVo): boolean {
    return this.value === other.value;
  }
}
