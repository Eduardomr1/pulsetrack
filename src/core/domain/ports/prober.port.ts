import { Endpoint } from '../entities/endpoint.entity';
import { HealthCheckResult } from '../entities/health-check.entity';

export interface IProberEngine {
  probe(endpoint: Endpoint): Promise<HealthCheckResult>;
}
