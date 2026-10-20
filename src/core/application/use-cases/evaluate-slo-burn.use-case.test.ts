import { describe, it, expect } from 'vitest';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import {
  EndpointAggregates,
  IHealthCheckRepository,
  TimeSeriesFilter,
} from '../../domain/ports/health-check.repository';
import {
  ISloAlertDispatcher,
  SloBurnAlertPayload,
} from '../../domain/ports/slo-alert-dispatcher.port';
import { MultiWindowBurnRateEvaluator } from '../../domain/services/multi-window-burn-rate.service';
import { SloAlertStateMachine } from '../../domain/services/slo-alert-deduplicator.service';
import { HealthStatusVo } from '../../domain/value-objects/health-status.vo';
import { HttpMethodVo } from '../../domain/value-objects/http-method.vo';
import { LatencyBreakdownVo } from '../../domain/value-objects/latency-breakdown.vo';
import { UrlVo } from '../../domain/value-objects/url.vo';
import { EvaluateEndpointSloBurnUseCase } from './evaluate-slo-burn.use-case';

class InMemoryEndpointRepository implements IEndpointRepository {
  private readonly items = new Map<string, Endpoint>();

  public async findById(id: string): Promise<Endpoint | null> {
    return this.items.get(id) ?? null;
  }

  public async findAll(): Promise<Endpoint[]> {
    return Array.from(this.items.values());
  }

  public async findAllActive(): Promise<Endpoint[]> {
    return Array.from(this.items.values()).filter((e) => e.isActive);
  }

  public async save(endpoint: Endpoint): Promise<void> {
    this.items.set(endpoint.id, endpoint);
  }

  public async update(endpoint: Endpoint): Promise<void> {
    this.items.set(endpoint.id, endpoint);
  }

  public async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

class InMemoryHealthCheckRepository implements IHealthCheckRepository {
  private checks: HealthCheckResult[] = [];

  public setChecks(checks: HealthCheckResult[]): void {
    this.checks = checks;
  }

  public async save(result: HealthCheckResult): Promise<void> {
    this.checks.push(result);
  }

  public async findLatestByEndpointId(endpointId: string): Promise<HealthCheckResult | null> {
    const filtered = this.checks
      .filter((c) => c.endpointId === endpointId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return filtered[0] ?? null;
  }

  public async findRecentByEndpointId(
    endpointId: string,
    limit: number = 50
  ): Promise<HealthCheckResult[]> {
    return this.checks
      .filter((c) => c.endpointId === endpointId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public async findHistory(filter: TimeSeriesFilter): Promise<HealthCheckResult[]> {
    const fromMs = filter.from.getTime();
    const toMs = filter.to.getTime();
    const matching = this.checks
      .filter(
        (c) =>
          c.endpointId === filter.endpointId &&
          c.timestamp.getTime() >= fromMs &&
          c.timestamp.getTime() <= toMs
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return filter.limit ? matching.slice(0, filter.limit) : matching;
  }

  public async getAggregates(): Promise<EndpointAggregates> {
    return {
      totalChecks: this.checks.length,
      healthyChecks: this.checks.length,
      degradedChecks: 0,
      downChecks: 0,
      uptimePercentage: 100,
      avgLatencyMs: 25,
      p50LatencyMs: 25,
      p95LatencyMs: 40,
      p99LatencyMs: 50,
    };
  }
}

class SpySloAlertDispatcher implements ISloAlertDispatcher {
  public readonly dispatched: SloBurnAlertPayload[] = [];

  public async dispatchSloAlert(payload: SloBurnAlertPayload): Promise<void> {
    this.dispatched.push(payload);
  }
}

function createSampleEndpoint(id: string = 'ep-payments'): Endpoint {
  return new Endpoint({
    id,
    name: 'Payments Gateway API',
    url: new UrlVo('https://payments.pulsetrack.io/v1/health'),
    method: new HttpMethodVo('GET'),
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatusCodes: [200],
    assertions: [],
    isActive: true,
    tags: ['payments', 'critical'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  });
}

function buildCheckSeries(params: {
  endpointId: string;
  refTime: Date;
  minutesBack: number;
  statusForMinuteAgo: (minAgo: number) => HealthStatusVo;
}): HealthCheckResult[] {
  const results: HealthCheckResult[] = [];
  for (let m = params.minutesBack; m >= 1; m -= 1) {
    const status = params.statusForMinuteAgo(m);
    results.push(
      new HealthCheckResult({
        id: `chk-${m}`,
        endpointId: params.endpointId,
        timestamp: new Date(params.refTime.getTime() - m * 60_000),
        status,
        statusCode: status.isDown() ? 503 : 200,
        statusText: status.isDown() ? 'Service Unavailable' : 'OK',
        latency: new LatencyBreakdownVo({
          dnsLookupMs: 2,
          tcpConnectMs: 4,
          tlsHandshakeMs: 9,
          ttfbMs: status.isDown() ? 0 : 28,
          contentTransferMs: 2,
          totalMs: status.isDown() ? 15 : 45,
        }),
        failedAssertions: [],
      })
    );
  }
  return results;
}

describe('EvaluateEndpointSloBurnUseCase', () => {
  it('lanza excepción descriptiva si el endpoint solicitado no existe', async () => {
    const useCase = new EvaluateEndpointSloBurnUseCase(
      new InMemoryEndpointRepository(),
      new InMemoryHealthCheckRepository()
    );

    await expect(useCase.execute({ endpointId: 'missing-id' })).rejects.toThrow(
      'Endpoint no encontrado: missing-id'
    );
  });

  it('evalúa historial saludable sin disparar alertas', async () => {
    const endpointRepo = new InMemoryEndpointRepository();
    const healthRepo = new InMemoryHealthCheckRepository();
    const dispatcher = new SpySloAlertDispatcher();
    const ep = createSampleEndpoint();
    await endpointRepo.save(ep);

    const refTime = new Date('2026-10-20T13:00:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime,
        minutesBack: 120,
        statusForMinuteAgo: () => HealthStatusVo.HEALTHY,
      })
    );

    const useCase = new EvaluateEndpointSloBurnUseCase(
      endpointRepo,
      healthRepo,
      new MultiWindowBurnRateEvaluator(),
      new SloAlertStateMachine(),
      dispatcher
    );

    const output = await useCase.execute({
      endpointId: ep.id,
      evaluationTime: refTime,
    });

    expect(output.burnReport.isFiring).toBe(false);
    expect(output.dispatchedNotification).toBe(false);
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  it('despacha SLO_BURN_FIRING, suprime duplicados consecutivos y despacha SLO_BURN_RESOLVED tras recuperación', async () => {
    const endpointRepo = new InMemoryEndpointRepository();
    const healthRepo = new InMemoryHealthCheckRepository();
    const dispatcher = new SpySloAlertDispatcher();
    const ep = createSampleEndpoint();
    await endpointRepo.save(ep);

    const useCase = new EvaluateEndpointSloBurnUseCase(
      endpointRepo,
      healthRepo,
      new MultiWindowBurnRateEvaluator(),
      new SloAlertStateMachine({ cooldownMinutes: 15 }),
      dispatcher
    );

    // T0: ráfaga de 3 fallos en los últimos 5m dentro de 24h saludables -> dispara PAGE_FAST
    const t0 = new Date('2026-10-20T13:00:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime: t0,
        minutesBack: 1440,
        statusForMinuteAgo: (m) => (m <= 3 ? HealthStatusVo.DOWN : HealthStatusVo.HEALTHY),
      })
    );

    const resFiring = await useCase.execute({ endpointId: ep.id, evaluationTime: t0 });
    expect(resFiring.burnReport.highestFiringTier).toBe('PAGE_FAST');
    expect(resFiring.dispatchedNotification).toBe(true);
    expect(dispatcher.dispatched[0]?.eventType).toBe('SLO_BURN_FIRING');

    // T1 (+1m): sigue fallando, debe suprimir duplicado
    const t1 = new Date('2026-10-20T13:01:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime: t1,
        minutesBack: 1440,
        statusForMinuteAgo: (m) => (m <= 4 ? HealthStatusVo.DOWN : HealthStatusVo.HEALTHY),
      })
    );

    const resDuplicate = await useCase.execute({ endpointId: ep.id, evaluationTime: t1 });
    expect(resDuplicate.alertDecision.action).toBe('SUPPRESS_DUPLICATE');
    expect(resDuplicate.dispatchedNotification).toBe(false);
    expect(dispatcher.dispatched).toHaveLength(1);

    // T2 (+15m): los 2 fallos quedaron en t-16m y t-15m, ventana corta 5m limpia -> resuelve alerta
    const t2 = new Date('2026-10-20T13:15:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime: t2,
        minutesBack: 1440,
        statusForMinuteAgo: (m) =>
          m === 15 || m === 16 ? HealthStatusVo.DOWN : HealthStatusVo.HEALTHY,
      })
    );

    const resResolved = await useCase.execute({ endpointId: ep.id, evaluationTime: t2 });
    expect(resResolved.burnReport.isFiring).toBe(false);
    expect(resResolved.alertDecision.action).toBe('DISPATCH_RESOLVED');
    expect(resResolved.dispatchedNotification).toBe(true);
    expect(dispatcher.dispatched).toHaveLength(2);
    expect(dispatcher.dispatched[1]?.eventType).toBe('SLO_BURN_RESOLVED');
  });

  it('despacha SLO_BURN_ESCALATED cuando un episodio TICKET escala a PAGE_FAST', async () => {
    const endpointRepo = new InMemoryEndpointRepository();
    const healthRepo = new InMemoryHealthCheckRepository();
    const dispatcher = new SpySloAlertDispatcher();
    const ep = createSampleEndpoint();
    await endpointRepo.save(ep);

    const useCase = new EvaluateEndpointSloBurnUseCase(
      endpointRepo,
      healthRepo,
      new MultiWindowBurnRateEvaluator(),
      new SloAlertStateMachine({ cooldownMinutes: 15 }),
      dispatcher
    );

    // T0: SLO 99% -> 1 fallo cada 25m durante 24h -> 4.0x burn rate -> TICKET
    const t0 = new Date('2026-10-20T13:00:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime: t0,
        minutesBack: 1440,
        statusForMinuteAgo: (m) => (m % 25 === 0 ? HealthStatusVo.DOWN : HealthStatusVo.HEALTHY),
      })
    );

    const firstEval = await useCase.execute({
      endpointId: ep.id,
      targetSloPercentage: 99.0,
      evaluationTime: t0,
    });
    expect(firstEval.burnReport.highestFiringTier).toBe('TICKET');
    expect(dispatcher.dispatched[0]?.eventType).toBe('SLO_BURN_FIRING');

    // T1 (+5m): caída total en últimos 15 minutos -> burn rate supera 14.4x -> PAGE_FAST
    const t1 = new Date('2026-10-20T13:05:00Z');
    healthRepo.setChecks(
      buildCheckSeries({
        endpointId: ep.id,
        refTime: t1,
        minutesBack: 1440,
        statusForMinuteAgo: (m) =>
          m <= 15 || m % 25 === 0 ? HealthStatusVo.DOWN : HealthStatusVo.HEALTHY,
      })
    );

    const escalatedEval = await useCase.execute({
      endpointId: ep.id,
      targetSloPercentage: 99.0,
      evaluationTime: t1,
    });
    expect(escalatedEval.burnReport.highestFiringTier).toBe('PAGE_FAST');
    expect(escalatedEval.alertDecision.action).toBe('DISPATCH_ESCALATION');
    expect(dispatcher.dispatched[1]?.eventType).toBe('SLO_BURN_ESCALATED');
  });
});
