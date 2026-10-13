import { randomUUID } from 'node:crypto';
import { IProberEngine } from '../../core/domain/ports/prober.port';
import { Endpoint } from '../../core/domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../core/domain/entities/health-check.entity';
import { HealthStatusVo } from '../../core/domain/value-objects/health-status.vo';
import { executeTelemetryProbe, RawProbeResult, TelemetryProbeOptions } from './http-telemetry-agent';
import { AssertionEvaluator } from './assertion-evaluator';

export type TelemetryProbeFunction = (options: TelemetryProbeOptions) => Promise<RawProbeResult>;

export class HttpProberEngine implements IProberEngine {
  constructor(
    private readonly region: string = 'primary-node',
    private readonly probeFn: TelemetryProbeFunction = executeTelemetryProbe
  ) {}

  public async probe(endpoint: Endpoint): Promise<HealthCheckResult> {
    const rawResult = await this.probeFn({
      url: endpoint.url.value,
      method: endpoint.method.value,
      headers: endpoint.headers,
      body: endpoint.body,
      timeoutMs: endpoint.timeoutMs,
    });

    const assertionResult = AssertionEvaluator.evaluate(
      endpoint.assertions,
      endpoint.expectedStatusCodes,
      rawResult
    );

    let status = HealthStatusVo.HEALTHY;
    const failedAssertions = [...assertionResult.failures];

    if (rawResult.errorMessage || rawResult.statusCode === null) {
      status = HealthStatusVo.DOWN;
    } else if (rawResult.statusCode >= 500) {
      status = HealthStatusVo.DOWN;
    } else if (!assertionResult.passed) {
      // Determine if it's down or degraded based on failure severity
      const hasStatusFailure = failedAssertions.some((f) => f.includes('Código de estado') || f.includes('Status code'));
      status = hasStatusFailure ? HealthStatusVo.DOWN : HealthStatusVo.DEGRADED;
    }

    // Check SSL certificate expiration warning (< 7 days degraded)
    if (rawResult.sslInfo && rawResult.sslInfo.daysRemaining <= 7 && status.isHealthy()) {
      status = HealthStatusVo.DEGRADED;
      failedAssertions.push(`Certificado SSL por expirar en ${rawResult.sslInfo.daysRemaining} días`);
    }

    return new HealthCheckResult({
      id: randomUUID(),
      endpointId: endpoint.id,
      timestamp: new Date(),
      status,
      statusCode: rawResult.statusCode,
      statusText: rawResult.statusText,
      latency: rawResult.latency,
      sslInfo: rawResult.sslInfo,
      errorMessage: rawResult.errorMessage,
      failedAssertions,
      responseHeaders: rawResult.responseHeaders,
      region: this.region,
      errorCode: rawResult.errorCode,
      resolvedAddress: rawResult.resolvedAddress,
    });
  }

  public async probeRaw(endpoint: Endpoint): Promise<RawProbeResult> {
    return this.probeFn({
      url: endpoint.url.value,
      method: endpoint.method.value,
      headers: endpoint.headers,
      body: endpoint.body,
      timeoutMs: endpoint.timeoutMs,
    });
  }
}
