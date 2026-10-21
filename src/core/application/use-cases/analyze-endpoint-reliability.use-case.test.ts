import { describe, it, expect } from 'vitest';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import { Incident } from '../../domain/entities/incident.entity';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import {
  EndpointAggregates,
  IHealthCheckRepository,
  TimeSeriesFilter,
} from '../../domain/ports/health-check.repository';
import { IIncidentRepository } from '../../domain/ports/incident.repository';
import {
  IMaintenanceWindowRepository,
  MaintenanceWindowRangeQuery,
} from '../../domain/ports/maintenance-window.repository';
import { HealthStatusVo } from '../../domain/value-objects/health-status.vo';
import { HttpMethodVo } from '../../domain/value-objects/http-method.vo';
import { LatencyBreakdownVo } from '../../domain/value-objects/latency-breakdown.vo';
import { UrlVo } from '../../domain/value-objects/url.vo';
import { AnalyzeEndpointReliabilityUseCase } from './analyze-endpoint-reliability.use-case';

class InMemoryEndpointRepo implements IEndpointRepository {
  private readonly store = new Map<string, Endpoint>();

  public async findById(id: string): Promise<Endpoint | null> {
    return this.store.get(id) ?? null;
  }

  public async findAll(): Promise<Endpoint[]> {
    return Array.from(this.store.values());
  }

  public async findAllActive(): Promise<Endpoint[]> {
    return Array.from(this.store.values()).filter((e) => e.isActive);
  }

  public async save(endpoint: Endpoint): Promise<void> {
    this.store.set(endpoint.id, endpoint);
  }

  public async update(endpoint: Endpoint): Promise<void> {
    this.store.set(endpoint.id, endpoint);
  }

  public async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

class InMemoryIncidentRepo implements IIncidentRepository {
  private readonly items: Incident[] = [];

  public async findById(id: string): Promise<Incident | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }

  public async findAll(limit?: number): Promise<Incident[]> {
    return limit ? this.items.slice(0, limit) : [...this.items];
  }

  public async findActiveByEndpointId(endpointId: string): Promise<Incident | null> {
    return this.items.find((i) => i.endpointId === endpointId && i.isOpen()) ?? null;
  }

  public async findByEndpointId(endpointId: string, limit?: number): Promise<Incident[]> {
    const matching = this.items.filter((i) => i.endpointId === endpointId);
    return limit ? matching.slice(0, limit) : matching;
  }

  public async findRecent(limit?: number): Promise<Incident[]> {
    return limit ? this.items.slice(0, limit) : [...this.items];
  }

  public async countActive(): Promise<number> {
    return this.items.filter((i) => i.isOpen()).length;
  }

  public async save(incident: Incident): Promise<void> {
    this.items.push(incident);
  }

  public async update(incident: Incident): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === incident.id);
    if (idx >= 0) {
      this.items[idx] = incident;
    }
  }
}

class InMemoryMaintenanceRepo implements IMaintenanceWindowRepository {
  private readonly windows: MaintenanceWindow[] = [];

  public async findById(id: string): Promise<MaintenanceWindow | null> {
    return this.windows.find((w) => w.id === id) ?? null;
  }

  public async findAll(): Promise<MaintenanceWindow[]> {
    return [...this.windows];
  }

  public async findOverlappingRange(
    query: MaintenanceWindowRangeQuery
  ): Promise<MaintenanceWindow[]> {
    return this.windows.filter(
      (w) => w.computeOverlapMs(query.from, query.to, query.endpointId) > 0
    );
  }

  public async findActiveAt(
    timestamp: Date,
    endpointId?: string
  ): Promise<MaintenanceWindow[]> {
    return this.windows.filter((w) => w.containsTimestamp(timestamp, endpointId));
  }

  public async save(window: MaintenanceWindow): Promise<void> {
    this.windows.push(window);
  }

  public async update(window: MaintenanceWindow): Promise<void> {
    const idx = this.windows.findIndex((w) => w.id === window.id);
    if (idx >= 0) {
      this.windows[idx] = window;
    }
  }
}

class InMemoryHealthCheckRepo implements IHealthCheckRepository {
  private readonly checks: HealthCheckResult[] = [];

  public async save(result: HealthCheckResult): Promise<void> {
    this.checks.push(result);
  }

  public async findLatestByEndpointId(endpointId: string): Promise<HealthCheckResult | null> {
    return this.checks.find((c) => c.endpointId === endpointId) ?? null;
  }

  public async findRecentByEndpointId(
    endpointId: string,
    limit: number = 50
  ): Promise<HealthCheckResult[]> {
    return this.checks.filter((c) => c.endpointId === endpointId).slice(0, limit);
  }

  public async findHistory(filter: TimeSeriesFilter): Promise<HealthCheckResult[]> {
    const fromMs = filter.from.getTime();
    const toMs = filter.to.getTime();
    return this.checks.filter(
      (c) =>
        c.endpointId === filter.endpointId &&
        c.timestamp.getTime() >= fromMs &&
        c.timestamp.getTime() <= toMs
    );
  }

  public async getAggregates(): Promise<EndpointAggregates> {
    return {
      totalChecks: this.checks.length,
      healthyChecks: this.checks.length,
      degradedChecks: 0,
      downChecks: 0,
      uptimePercentage: 100,
      avgLatencyMs: 30,
      p50LatencyMs: 28,
      p95LatencyMs: 42,
      p99LatencyMs: 55,
    };
  }
}

function buildSampleEndpoint(id: string = 'ep-ledger'): Endpoint {
  return new Endpoint({
    id,
    name: 'Core Ledger Service',
    url: new UrlVo('https://ledger.pulsetrack.io/healthz'),
    method: new HttpMethodVo('GET'),
    intervalSeconds: 15,
    timeoutMs: 3000,
    expectedStatusCodes: [200],
    assertions: [],
    isActive: true,
    tags: ['ledger', 'tier-0'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    consecutiveFailuresThreshold: 4,
  });
}

describe('AnalyzeEndpointReliabilityUseCase', () => {
  it('falla de forma controlada si el endpoint no existe o el SLO objetivo es inválido', async () => {
    const endpointRepo = new InMemoryEndpointRepo();
    const incidentRepo = new InMemoryIncidentRepo();
    const maintenanceRepo = new InMemoryMaintenanceRepo();
    const useCase = new AnalyzeEndpointReliabilityUseCase(
      endpointRepo,
      incidentRepo,
      maintenanceRepo
    );

    const windowStart = new Date('2026-10-01T00:00:00Z');
    const windowEnd = new Date('2026-10-31T00:00:00Z');

    await expect(
      useCase.execute({ endpointId: 'ep-404', windowStart, windowEnd })
    ).rejects.toThrow('Endpoint no encontrado: ep-404');

    const ep = buildSampleEndpoint();
    await endpointRepo.save(ep);

    await expect(
      useCase.execute({
        endpointId: ep.id,
        windowStart,
        windowEnd,
        targetSloPercentage: 100,
      })
    ).rejects.toThrow('rango (0, 100)');
  });

  it('preserva cumplimiento SLO (wasSavedByMaintenanceExclusion=true) cuando una caída grande ocurre en mantenimiento pactado', async () => {
    const endpointRepo = new InMemoryEndpointRepo();
    const incidentRepo = new InMemoryIncidentRepo();
    const maintenanceRepo = new InMemoryMaintenanceRepo();
    const healthRepo = new InMemoryHealthCheckRepo();

    const ep = buildSampleEndpoint();
    await endpointRepo.save(ep);

    // Ventana de 30 días = 43,200 min. SLO 99.9% permite ~43.2 min de caída no planificada.
    const windowStart = new Date('2026-10-01T00:00:00Z');
    const windowEnd = new Date('2026-10-31T00:00:00Z');

    // Mantenimiento programado de 2 horas (120 min) el 15 de octubre -> tiempo elegible = 43,080 min
    await maintenanceRepo.save(
      new MaintenanceWindow({
        id: 'mw-oct-15',
        title: 'Rotación de certificados mTLS y upgrade de base de datos',
        startTime: new Date('2026-10-15T02:00:00Z'),
        endTime: new Date('2026-10-15T04:00:00Z'),
        affectedEndpoints: [ep.id],
      })
    );

    // Caída de 90 min dentro del mantenimiento (que sin ajuste violaría el presupuesto de 43.2 min)
    await incidentRepo.save(
      new Incident({
        id: 'inc-planned',
        endpointId: ep.id,
        status: 'RESOLVED',
        severity: 'CRITICAL',
        startedAt: new Date('2026-10-15T02:15:00Z'),
        resolvedAt: new Date('2026-10-15T03:45:00Z'),
        summary: 'Corte esperado durante failover de base de datos',
        consecutiveFailures: 180,
      })
    );

    // Además un episodio real no planificado con flapping (3 micro-cortes de 4 min = 12 min totales < 43.08 min permitidos)
    const flapStarts = ['10:00:00Z', '10:07:00Z', '10:14:00Z'];
    const flapEnds = ['10:04:00Z', '10:11:00Z', '10:18:00Z'];
    for (let i = 0; i < 3; i += 1) {
      await incidentRepo.save(
        new Incident({
          id: `inc-flap-${i + 1}`,
          endpointId: ep.id,
          status: 'RESOLVED',
          severity: 'WARNING',
          startedAt: new Date(`2026-10-20T${flapStarts[i]}`),
          acknowledgedAt:
            i === 0 ? new Date('2026-10-20T10:02:00Z') : null,
          resolvedAt: new Date(`2026-10-20T${flapEnds[i]}`),
          summary: 'Inestabilidad transitoria en ingress controller',
          consecutiveFailures: 6,
        })
      );
    }

    // Sembrar sondeos: 2 fallidos durante mantenimiento + 98 exitosos fuera + 1 fallido fuera + 1 degradado fuera
    const latency = new LatencyBreakdownVo({
      dnsLookupMs: 2,
      tcpConnectMs: 3,
      tlsHandshakeMs: 7,
      ttfbMs: 18,
      contentTransferMs: 2,
      totalMs: 32,
    });

    await healthRepo.save(
      new HealthCheckResult({
        id: 'chk-maint-1',
        endpointId: ep.id,
        timestamp: new Date('2026-10-15T02:30:00Z'),
        status: HealthStatusVo.DOWN,
        statusCode: 503,
        statusText: 'Maintenance',
        latency,
        failedAssertions: [],
      })
    );
    await healthRepo.save(
      new HealthCheckResult({
        id: 'chk-maint-2',
        endpointId: ep.id,
        timestamp: new Date('2026-10-15T03:00:00Z'),
        status: HealthStatusVo.DOWN,
        statusCode: 503,
        statusText: 'Maintenance',
        latency,
        failedAssertions: [],
      })
    );

    for (let k = 1; k <= 98; k += 1) {
      await healthRepo.save(
        new HealthCheckResult({
          id: `chk-ok-${k}`,
          endpointId: ep.id,
          timestamp: new Date(windowStart.getTime() + k * 60_000),
          status: HealthStatusVo.HEALTHY,
          statusCode: 200,
          statusText: 'OK',
          latency,
          failedAssertions: [],
        })
      );
    }

    await healthRepo.save(
      new HealthCheckResult({
        id: 'chk-deg-1',
        endpointId: ep.id,
        timestamp: new Date('2026-10-20T10:01:00Z'),
        status: HealthStatusVo.DEGRADED,
        statusCode: 200,
        statusText: 'OK',
        latency,
        failedAssertions: ['Response time exceeded threshold'],
      })
    );
    await healthRepo.save(
      new HealthCheckResult({
        id: 'chk-down-1',
        endpointId: ep.id,
        timestamp: new Date('2026-10-20T10:02:00Z'),
        status: HealthStatusVo.DOWN,
        statusCode: 502,
        statusText: 'Bad Gateway',
        latency,
        failedAssertions: [],
      })
    );

    const useCase = new AnalyzeEndpointReliabilityUseCase(
      endpointRepo,
      incidentRepo,
      maintenanceRepo,
      healthRepo
    );

    const result = await useCase.execute({
      endpointId: ep.id,
      windowStart,
      windowEnd,
      targetSloPercentage: 99.9,
      coalesceGapMinutes: 5,
      flappingThreshold: 3,
    });

    // Raw downtime = 90 + 12 = 102 min -> rawUptime = 99.7639% (< 99.9%)
    // Adjusted unplanned downtime = 12 min sobre 43,080 min -> adjustedUptime = 99.9721% (>= 99.9%)
    expect(result.reliability.rawDowntimeMinutes).toBe(102);
    expect(result.reliability.excludedMaintenanceDowntimeMinutes).toBe(90);
    expect(result.reliability.effectiveUnplannedDowntimeMinutes).toBe(12);
    expect(result.reliability.flappingEpisodesCount).toBe(1);
    expect(result.reliability.meanTimeToDetectSeconds).toBe(60); // 15s * 4
    expect(result.reliability.meanTimeToAcknowledgeMinutes).toBe(2);
    expect(result.reliability.meanTimeToResolveMinutes).toBe(12);

    expect(result.errorBudget.isSloCompliant).toBe(true);
    expect(result.errorBudget.wasSavedByMaintenanceExclusion).toBe(true);
    expect(result.errorBudget.allowedUnplannedDowntimeMinutes).toBe(43.08);
    expect(result.errorBudget.remainingErrorBudgetMinutes).toBe(31.08);

    // Sondeos filtrados: 102 totales, 2 excluidos por mantenimiento -> 100 elegibles (98 OK, 1 DEGRADED=0.5, 1 DOWN=0 -> 98.5%)
    expect(result.probeStats).not.toBeNull();
    expect(result.probeStats?.totalProbes).toBe(102);
    expect(result.probeStats?.excludedMaintenanceProbes).toBe(2);
    expect(result.probeStats?.eligibleProbes).toBe(100);
    expect(result.probeStats?.probeAdjustedAvailabilityPercentage).toBe(98.5);
  });
});
