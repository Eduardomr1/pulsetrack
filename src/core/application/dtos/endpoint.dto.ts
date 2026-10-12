import { AssertionRule } from '../../domain/value-objects/assertion.vo';
import { HttpMethod } from '../../domain/value-objects/http-method.vo';

export interface CreateEndpointDto {
  name: string;
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCodes?: number[];
  assertions?: AssertionRule[];
  tags?: string[];
}

export interface EndpointResponseDto {
  id: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
