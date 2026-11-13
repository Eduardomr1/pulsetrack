import { describe, expect, it, vi } from 'vitest';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import { Incident } from '../../domain/entities/incident.entity';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
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
import { IAlertNotifier } from '../../domain/ports/notifier.port';
import { IProberEngine } from '../../domain/ports/prober.port';
import { HealthStatusVo } from '../../domain/value-objects/health-status.vo';
import { HttpMethodVo } from '../../domain/value-objects/http-method.vo';
import { LatencyBreakdownVo } from '../../domain/value-objects/latency-breakdown.vo';
import { UrlVo } from '../../domain/value-objects/url.vo';
import { TelemetryEventBus } from '../../../infrastructure/events/telemetry-event-bus';
import { StateTransitionDetector } from '../../engine/state-transition-detector';
import { ExecuteProbeUseCase } from './execute-probe.use-case';

class StubHealthCheckRepo implements IHealthCheckRepository {
  public readonly saved: HealthCheckResult[] = [];
  public async save(result: HealthCheckResult): Promise<void> {
    this.saved.push(result);
  }
  public async findLatestByEndpointId(): Promise<HealthCheckResult | null> {
    return this.saved[this.saved.length - 1] ?? null;
  }
  public async findRecentByEndpointId(): Promise<HealthCheckResult[]> {
    return [...this.saved];
  }
  public async findHistory(_filter: TimeSeriesFilter): Promise<HealthCheckResult[]> {
    return [...this.saved];
  }
  public async getAggregates(): Promise<EndpointAggregates> {
    return {
      totalChecks: this.saved.length,
      healthyChecks: this.saved.filter((s) => s.isSuccess()).length,
      degradedChecks: this.saved.filter((s) => s.isDegraded()).length,
      downChecks: this.saved.filter((s) => s.isFailed()).length,
      uptimePercentage: 100,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
    };
  }
}

class StubIncidentRepo implements IIncidentRepository {
  public readonly items: Incident[] = [];
  public async findById(id: string): Promise<Incident | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  public async findAll(): Promise<Incident[]> {
    return [...this.items];
  }
  public async findActiveByEndpointId(endpointId: string): Promise<Incident | null> {
    return this.items.find((i) => i.endpointId === endpointId && i.isOpen()) ?? null;
  }
  public async findByEndpointId(endpointId: string): Promise<Incident[]> {
    return this.items.filter((i) => i.endpointId === endpointId);
  }
  public async findRecent(): Promise<Incident[]> {
    return [...this.items];
  }
  public async countActive(): Promise<number> {
    return this.items.filter((i) => i.isOpen()).length;
  }
  public async save(incident: Incident): Promise<void> {
    this.items.push(incident);
  }
  public async update(incident: Incident): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === incident.id);
    if (idx >= 0) this.items[idx] = incident;
  }
}

class StubMaintenanceRepo implements IMaintenanceWindowRepository {
  constructor(private readonly windows: MaintenanceWindow[] = []) {}
  public async findById(id: string): Promise<MaintenanceWindow | null> {
    return this.windows.find((w) => w.id === id) ?? null;
  }
  public async findAll(): Promise<MaintenanceWindow[]> {
    return [...this.windows];
  }
  public async findOverlappingRange(_q: MaintenanceWindowRangeQuery): Promise<MaintenanceWindow[]> {
    return [...this.windows];
  }
  public async findActiveAt(timestamp: Date, endpointId?: string): Promise<MaintenanceWindow[]> {
    return this.windows.filter((w) => w.containsTimestamp(timestamp, endpointId));
  }
  public async save(window: MaintenanceWindow): Promise<void> {
    this.windows.push(window);
  }
  public async update(window: MaintenanceWindow): Promise<void> {
    const idx = this.windows.findIndex((w) => w.id === window.id);
    if (idx >= 0) this.windows[idx] = window;
  }
}

function makeEndpoint(
  consecutiveFailuresThreshold = 1,
  consecutiveSuccessThreshold = 1
): Endpoint {
  const now = new Date('2026-11-13T00:00:00Z');
  return new Endpoint({
    id: 'ep-checkout',
    name: 'Checkout Service',
    url: new UrlVo('https://api.example.com/checkout'),
    method: new HttpMethodVo('GET'),
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatusCodes: [200],
    assertions: [],
    isActive: true,
    tags: ['core'],
    consecutiveFailuresThreshold,
    consecutiveSuccessThreshold,
    createdAt: now,
    updatedAt: now,
  });
}

function makeCheck(
  timestamp: Date,
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN'
): HealthCheckResult {
  return new HealthCheckResult({
    id: `chk-${timestamp.getTime()}`,
    endpointId: 'ep-checkout',
    timestamp,
    status: HealthStatusVo.fromString(status),
    statusCode: status === 'OPERATIONAL' ? 200 : 503,
    statusText: status === 'OPERATIONAL' ? 'OK' : 'Service Unavailable',
    latency: new LatencyBreakdownVo({
      dnsLookupMs: 5,
      tcpConnectMs: 10,
      tlsHandshakeMs: 15,
      ttfbMs: 40,
      contentTransferMs: 5,
      totalMs: 75,
    }),
    errorMessage: status === 'DOWN' ? 'HTTP 503 Upstream unavailable' : null,
    failedAssertions: [],
  });
}

describe('ExecuteProbeUseCase - Supresión por Mantenimiento', () => {
  it('suprime incidentes y notificaciones durante ventana de mantenimiento manteniendo telemetría', async () => {
    const probeTime = new Date('2026-11-13T02:10:00Z');
    const maintenance = new MaintenanceWindow({
      id: 'mw-active',
      title: 'Actualización de Gateway',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T02:30:00Z'),
      affectedEndpoints: ['ep-checkout'],
    });

    const prober: IProberEngine = {
      probe: vi.fn(async () => makeCheck(probeTime, 'DOWN')),
    };
    const healthRepo = new StubHealthCheckRepo();
    const incidentRepo = new StubIncidentRepo();
    const notifier: IAlertNotifier = { notify: vi.fn(async () => {}) };
    const maintenanceRepo = new StubMaintenanceRepo([maintenance]);
    const detector = new StateTransitionDetector();

    const useCase = new ExecuteProbeUseCase(
      prober,
      healthRepo,
      incidentRepo,
      notifier,
      new TelemetryEventBus(),
      detector,
      maintenanceRepo
    );

    const outcome = await useCase.executeWithOutcome({ endpoint: makeEndpoint(1) });

    expect(healthRepo.saved).toHaveLength(1);
    expect(incidentRepo.items).toHaveLength(0);
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(outcome.suppressedByMaintenance).toBe(true);
    expect(outcome.activeMaintenanceWindowId).toBe('mw-active');
    expect(outcome.incidentAction).toBe('SUPPRESSED_BY_MAINTENANCE');
  });

  it('dispara incidente normalmente cuando la ventana activa aplica a otro endpoint', async () => {
    const probeTime = new Date('2026-11-13T02:10:00Z');
    const maintenanceOther = new MaintenanceWindow({
      id: 'mw-other',
      title: 'Mantenimiento Search',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T02:30:00Z'),
      affectedEndpoints: ['ep-search'],
    });

    const prober: IProberEngine = {
      probe: vi.fn(async () => makeCheck(probeTime, 'DOWN')),
    };
    const healthRepo = new StubHealthCheckRepo();
    const incidentRepo = new StubIncidentRepo();
    const notifier: IAlertNotifier = { notify: vi.fn(async () => {}) };
    const maintenanceRepo = new StubMaintenanceRepo([maintenanceOther]);

    const useCase = new ExecuteProbeUseCase(
      prober,
      healthRepo,
      incidentRepo,
      notifier,
      new TelemetryEventBus(),
      new StateTransitionDetector(),
      maintenanceRepo
    );

    const outcome = await useCase.executeWithOutcome({ endpoint: makeEndpoint(1) });

    expect(outcome.suppressedByMaintenance).toBe(false);
    expect(outcome.incidentAction).toBe('TRIGGERED');
    expect(incidentRepo.items).toHaveLength(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('permite resolver un incidente previo si el servicio se recupera durante mantenimiento', async () => {
    const preMaintFailTime = new Date('2026-11-13T01:55:00Z');
    const duringMaintHealthyTime = new Date('2026-11-13T02:05:00Z');

    const maintenance = new MaintenanceWindow({
      id: 'mw-active',
      title: 'Hotfix deploy',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T02:30:00Z'),
      affectedEndpoints: ['*'],
    });

    const prober: IProberEngine = {
      probe: vi
        .fn()
        .mockResolvedValueOnce(makeCheck(preMaintFailTime, 'DOWN'))
        .mockResolvedValueOnce(makeCheck(duringMaintHealthyTime, 'OPERATIONAL')),
    };
    const healthRepo = new StubHealthCheckRepo();
    const incidentRepo = new StubIncidentRepo();
    const notifier: IAlertNotifier = { notify: vi.fn(async () => {}) };
    const maintenanceRepo = new StubMaintenanceRepo([maintenance]);

    const useCase = new ExecuteProbeUseCase(
      prober,
      healthRepo,
      incidentRepo,
      notifier,
      new TelemetryEventBus(),
      new StateTransitionDetector(),
      maintenanceRepo
    );

    const ep = makeEndpoint(1);
    await useCase.executeWithOutcome({ endpoint: ep });
    expect(incidentRepo.items[0]?.status).toBe('OPEN');

    const recoveryOutcome = await useCase.executeWithOutcome({ endpoint: ep });
    expect(recoveryOutcome.incidentAction).toBe('RESOLVED');
    expect(incidentRepo.items[0]?.status).toBe('RESOLVED');
    expect(notifier.notify).toHaveBeenCalledTimes(2); // DOWN + RECOVERED
  });
});
