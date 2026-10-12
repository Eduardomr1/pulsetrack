import { UrlVo } from '../value-objects/url.vo';
import { HttpMethodVo } from '../value-objects/http-method.vo';
import { AssertionVo } from '../value-objects/assertion.vo';

export interface EndpointProps {
  id: string;
  name: string;
  url: UrlVo;
  method: HttpMethodVo;
  headers?: Record<string, string>;
  body?: string | null;
  intervalSeconds: number; // e.g. 10, 30, 60
  timeoutMs: number; // e.g. 5000
  expectedStatusCodes: number[]; // e.g. [200, 201]
  assertions: AssertionVo[];
  isActive: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class Endpoint {
  public readonly id: string;
  public name: string;
  public url: UrlVo;
  public method: HttpMethodVo;
  public headers: Record<string, string>;
  public body: string | null;
  public intervalSeconds: number;
  public timeoutMs: number;
  public expectedStatusCodes: number[];
  public assertions: AssertionVo[];
  public isActive: boolean;
  public tags: string[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor(props: EndpointProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('El nombre del endpoint no puede estar vacío');
    }
    if (props.intervalSeconds < 5) {
      throw new Error('El intervalo mínimo de sondeo es de 5 segundos');
    }
    if (props.timeoutMs <= 0 || props.timeoutMs > 60000) {
      throw new Error('El timeout debe estar entre 1ms y 60000ms');
    }

    this.id = props.id;
    this.name = props.name.trim();
    this.url = props.url;
    this.method = props.method;
    this.headers = props.headers ?? {};
    this.body = props.body ?? null;
    this.intervalSeconds = props.intervalSeconds;
    this.timeoutMs = props.timeoutMs;
    this.expectedStatusCodes = props.expectedStatusCodes.length > 0 ? props.expectedStatusCodes : [200];
    this.assertions = props.assertions;
    this.isActive = props.isActive;
    this.tags = props.tags;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  public pause(): void {
    this.isActive = false;
    this.updatedAt = new Date();
  }

  public activate(): void {
    this.isActive = true;
    this.updatedAt = new Date();
  }

  public updateConfig(props: Partial<Omit<EndpointProps, 'id' | 'createdAt'>>): void {
    if (props.name !== undefined) this.name = props.name.trim();
    if (props.url !== undefined) this.url = props.url;
    if (props.method !== undefined) this.method = props.method;
    if (props.headers !== undefined) this.headers = props.headers;
    if (props.body !== undefined) this.body = props.body;
    if (props.intervalSeconds !== undefined) this.intervalSeconds = props.intervalSeconds;
    if (props.timeoutMs !== undefined) this.timeoutMs = props.timeoutMs;
    if (props.expectedStatusCodes !== undefined) this.expectedStatusCodes = props.expectedStatusCodes;
    if (props.assertions !== undefined) this.assertions = props.assertions;
    if (props.tags !== undefined) this.tags = props.tags;
    this.updatedAt = new Date();
  }
}
