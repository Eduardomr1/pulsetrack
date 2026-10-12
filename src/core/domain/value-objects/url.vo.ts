export class UrlVo {
  public readonly value: string;
  public readonly protocol: 'http:' | 'https:';
  public readonly host: string;
  public readonly pathname: string;

  constructor(rawUrl: string) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('La URL no puede estar vacía');
    }

    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Protocolo no soportado: "${parsed.protocol}". Use http: o https:`);
      }
      this.value = parsed.href;
      this.protocol = parsed.protocol as 'http:' | 'https:';
      this.host = parsed.host;
      this.pathname = parsed.pathname;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Protocolo no soportado')) {
        throw err;
      }
      throw new Error(`URL inválida: "${rawUrl}"`);
    }
  }

  public isHttps(): boolean {
    return this.protocol === 'https:';
  }

  public toString(): string {
    return this.value;
  }
}
