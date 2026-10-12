import { randomUUID } from 'node:crypto';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { UrlVo } from '../../domain/value-objects/url.vo';
import { HttpMethodVo } from '../../domain/value-objects/http-method.vo';
import { AssertionVo } from '../../domain/value-objects/assertion.vo';
import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import { CreateEndpointDto } from '../dtos/endpoint.dto';
import { ExecuteProbeUseCase } from './execute-probe.use-case';

export class RegisterEndpointUseCase {
  constructor(
    private readonly endpointRepo: IEndpointRepository,
    private readonly executeProbeUseCase?: ExecuteProbeUseCase
  ) {}

  public async execute(dto: CreateEndpointDto): Promise<Endpoint> {
    const assertions = (dto.assertions ?? []).map((a) => new AssertionVo(a));

    const endpoint = new Endpoint({
      id: randomUUID(),
      name: dto.name,
      url: new UrlVo(dto.url),
      method: new HttpMethodVo(dto.method ?? 'GET'),
      headers: dto.headers ?? {},
      body: dto.body ?? null,
      intervalSeconds: dto.intervalSeconds ?? 30,
      timeoutMs: dto.timeoutMs ?? 5000,
      expectedStatusCodes: dto.expectedStatusCodes ?? [200],
      assertions,
      isActive: true,
      tags: dto.tags ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.endpointRepo.save(endpoint);

    // Run baseline initial probe asynchronously
    if (this.executeProbeUseCase) {
      void this.executeProbeUseCase.execute({ endpoint }).catch((err) => {
        console.error(`[RegisterEndpoint] Error en sonda inicial para ${endpoint.name}:`, err);
      });
    }

    return endpoint;
  }
}
