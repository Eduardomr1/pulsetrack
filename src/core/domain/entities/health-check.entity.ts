import { HealthStatusVo } from '../value-objects/health-status.vo';
import { LatencyBreakdownVo } from '../value-objects/latency-breakdown.vo';

export interface SslInfo {
  valid: boolean;
  issuer: string;
  validTo: string;
  daysRemaining: number;
}

export interface HealthCheckResultProps {
  id: string;
  endpointId: string;
  timestamp: Date;
  status: HealthStatusVo;
  statusCode: number | null;
  statusText: string | null;
  latency: LatencyBreakdownVo;
  sslInfo?: SslInfo | null;
  errorMessage?: string | null;
  failedAssertions: string[];
  responseHeaders?: Record<string, string>;
  region?: string;
  errorCode?: string | null;
  resolvedAddress?: string | null;
}

export class HealthCheckResult {
  public readonly id: string;
  public readonly endpointId: string;
  public readonly timestamp: Date;
  public readonly status: HealthStatusVo;
  public readonly statusCode: number | null;
  public readonly statusText: string | null;
  public readonly latency: LatencyBreakdownVo;
  public readonly sslInfo: SslInfo | null;
  public readonly errorMessage: string | null;
  public readonly failedAssertions: readonly string[];
  public readonly responseHeaders: Record<string, string>;
  public readonly region: string;
  public readonly errorCode: string | null;
  public readonly resolvedAddress: string | null;

  constructor(props: HealthCheckResultProps) {
    this.id = props.id;
    this.endpointId = props.endpointId;
    this.timestamp = props.timestamp;
    this.status = props.status;
    this.statusCode = props.statusCode;
    this.statusText = props.statusText;
    this.latency = props.latency;
    this.sslInfo = props.sslInfo ?? null;
    this.errorMessage = props.errorMessage ?? null;
    this.failedAssertions = Object.freeze([...props.failedAssertions]);
    this.responseHeaders = props.responseHeaders ?? {};
    this.region = props.region ?? 'primary';
    this.errorCode = props.errorCode ?? null;
    this.resolvedAddress = props.resolvedAddress ?? null;
  }

  public isSuccess(): boolean {
    return this.status.isHealthy();
  }

  public isOperational(): boolean {
    return this.status.isOperational();
  }

  public isDegraded(): boolean {
    return this.status.isDegraded();
  }

  public isFailed(): boolean {
    return this.status.isDown();
  }
}
