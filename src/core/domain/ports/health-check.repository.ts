import { HealthCheckResult } from '../entities/health-check.entity';

export interface TimeSeriesFilter {
  endpointId: string;
  from: Date;
  to: Date;
  limit?: number;
}

export interface EndpointAggregates {
  totalChecks: number;
  healthyChecks: number;
  degradedChecks: number;
  downChecks: number;
  uptimePercentage: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface IHealthCheckRepository {
  save(result: HealthCheckResult): Promise<void>;
  findLatestByEndpointId(endpointId: string): Promise<HealthCheckResult | null>;
  findRecentByEndpointId(endpointId: string, limit?: number): Promise<HealthCheckResult[]>;
  findHistory(filter: TimeSeriesFilter): Promise<HealthCheckResult[]>;
  getAggregates(endpointId: string, since: Date): Promise<EndpointAggregates>;
}
