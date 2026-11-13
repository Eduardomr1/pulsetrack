import { randomUUID } from 'node:crypto';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import { Incident } from '../../domain/entities/incident.entity';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
import { IProberEngine } from '../../domain/ports/prober.port';
import { IHealthCheckRepository } from '../../domain/ports/health-check.repository';
import { IIncidentRepository } from '../../domain/ports/incident.repository';
import { IMaintenanceWindowRepository } from '../../domain/ports/maintenance-window.repository';
import { IAlertNotifier } from '../../domain/ports/notifier.port';
import { TelemetryEventBus, telemetryEventBus } from '@/infrastructure/events/telemetry-event-bus';
import { StateTransitionDetector, StateEvaluationResult } from '../../engine/state-transition-detector';

export interface ExecuteProbeCommand {
  endpoint: Endpoint;
}

export type ProbeIncidentAction =
  | 'NONE'
  | 'TRIGGERED'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'SUPPRESSED_BY_MAINTENANCE';

export interface ProbeExecutionOutcome {
  readonly result: HealthCheckResult;
  readonly suppressedByMaintenance: boolean;
  readonly activeMaintenanceWindowId: string | null;
  readonly activeMaintenanceTitle: string | null;
  readonly incidentAction: ProbeIncidentAction;
}

export class ExecuteProbeUseCase {
  constructor(
    private readonly prober: IProberEngine,
    private readonly healthCheckRepo: IHealthCheckRepository,
    private readonly incidentRepo: IIncidentRepository,
    private readonly notifier?: IAlertNotifier,
    private readonly eventBus: TelemetryEventBus = telemetryEventBus,
    private readonly stateDetector: StateTransitionDetector = new StateTransitionDetector(),
    private readonly maintenanceWindowRepo?: IMaintenanceWindowRepository
  ) {}

  public async execute(command: ExecuteProbeCommand): Promise<HealthCheckResult> {
    const outcome = await this.executeWithOutcome(command);
    return outcome.result;
  }

  /**
   * Ejecuta una sonda telemétrica completa devolviendo metadatos sobre si las alertas
   * o generación de incidentes fueron suprimidos por una ventana de mantenimiento activa.
   */
  public async executeWithOutcome(
    command: ExecuteProbeCommand
  ): Promise<ProbeExecutionOutcome> {
    const { endpoint } = command;

    // 1. Run low-level telemetry probe & assertion evaluation
    const result = await this.prober.probe(endpoint);

    // 2. Persist health check sample in time-series storage (siempre visible en telemetría)
    await this.healthCheckRepo.save(result);

    // 3. Check if endpoint is currently covered by an active scheduled maintenance window
    const activeMaintenance = await this.findActiveMaintenance(endpoint.id, result.timestamp);

    let incidentAction: ProbeIncidentAction = 'NONE';
    let suppressedByMaintenance = false;

    if (activeMaintenance && !result.status.isHealthy()) {
      // Durante mantenimiento programado, suprimimos la generación/escalamiento de incidentes
      // y evitamos acumular fallos en el detector de transición para no disparar alertas en falso.
      suppressedByMaintenance = true;
      incidentAction = 'SUPPRESSED_BY_MAINTENANCE';
    } else {
      // 4. Process state transition with anti-false-positive filtering
      const transitionResult = this.stateDetector.processSample(endpoint.id, result, {
        consecutiveFailuresThreshold: endpoint.consecutiveFailuresThreshold,
        consecutiveDegradedThreshold: endpoint.consecutiveDegradedThreshold,
        consecutiveSuccessThreshold: endpoint.consecutiveSuccessThreshold,
      });

      // 5. Incident State Machine & Notification Transition
      incidentAction = await this.handleIncidentLifecycle(endpoint, result, transitionResult);
    }

    // 6. Emit probe result in real-time to event bus subscribers
    this.eventBus.emitProbeResult({ endpoint, result });

    return {
      result,
      suppressedByMaintenance,
      activeMaintenanceWindowId: activeMaintenance?.id ?? null,
      activeMaintenanceTitle: activeMaintenance?.title ?? null,
      incidentAction,
    };
  }

  private async findActiveMaintenance(
    endpointId: string,
    timestamp: Date
  ): Promise<MaintenanceWindow | null> {
    if (!this.maintenanceWindowRepo) {
      return null;
    }
    const activeWindows = await this.maintenanceWindowRepo.findActiveAt(timestamp, endpointId);
    return activeWindows.find((win) => win.isEffective()) ?? null;
  }

  private async handleIncidentLifecycle(
    endpoint: Endpoint,
    result: HealthCheckResult,
    transitionResult?: StateEvaluationResult
  ): Promise<ProbeIncidentAction> {
    const activeIncident = await this.incidentRepo.findActiveByEndpointId(endpoint.id);

    const isConfirmedDown = transitionResult
      ? transitionResult.currentState === 'DOWN'
      : result.status.isDown();

    const isConfirmedOperational = transitionResult
      ? transitionResult.currentState === 'OPERATIONAL'
      : result.status.isHealthy();

    const hasJustTransitionedToDown = transitionResult
      ? transitionResult.hasTransitioned && transitionResult.currentState === 'DOWN'
      : result.status.isDown() && !activeIncident;

    if (isConfirmedDown) {
      if (activeIncident) {
        activeIncident.incrementFailures();
        if (activeIncident.consecutiveFailures % 3 === 0 || activeIncident.consecutiveFailures === 2) {
          activeIncident.addTimelineNote(
            `Fallo continuo detectado (#${activeIncident.consecutiveFailures}): ${result.errorMessage ?? 'Sonda no responde o viola aserciones'}`,
            'PulseTrack Prober Engine'
          );
        }
        await this.incidentRepo.update(activeIncident);

        this.eventBus.emitIncident({
          incident: activeIncident,
          endpoint,
          endpointId: endpoint.id,
          type: 'ESCALATED',
        });
        return 'ESCALATED';
      }

      if (hasJustTransitionedToDown || !transitionResult) {
        const consecutiveCount = transitionResult ? transitionResult.consecutiveFailures : 1;
        const reason =
          result.errorMessage ??
          (result.failedAssertions.length > 0
            ? `Aserciones no cumplidas: ${result.failedAssertions.join(', ')}`
            : `Código HTTP inesperado: ${result.statusCode ?? 'N/A'}`);

        const newIncident = new Incident({
          id: randomUUID(),
          endpointId: endpoint.id,
          status: 'OPEN',
          severity: 'CRITICAL',
          startedAt: result.timestamp,
          summary: `Falló la sonda HTTP (${consecutiveCount} fallos consecutivos): ${reason}`,
          rootCause: reason,
          consecutiveFailures: consecutiveCount,
        });

        await this.incidentRepo.save(newIncident);

        this.eventBus.emitIncident({
          incident: newIncident,
          endpoint,
          endpointId: endpoint.id,
          type: 'TRIGGERED',
        });

        if (this.notifier) {
          await this.notifier.notify({
            endpoint,
            result,
            incident: newIncident,
            type: 'DOWN',
          });
        }
        return 'TRIGGERED';
      }
    } else if (isConfirmedOperational && activeIncident) {
      // Endpoint has recovered!
      const resolutionMsg = activeIncident.rootCause
        ? `Mitigado: Tráfico HTTP restaurado con código ${result.statusCode ?? 200} y latencia ${result.latency.totalMs.toFixed(1)}ms`
        : 'Mitigado: Respuesta saludable detectada';

      activeIncident.resolve(result.timestamp, resolutionMsg, 'PulseTrack Prober Engine');
      await this.incidentRepo.update(activeIncident);

      this.eventBus.emitIncident({
        incident: activeIncident,
        endpoint,
        endpointId: endpoint.id,
        type: 'RESOLVED',
      });

      if (this.notifier) {
        await this.notifier.notify({
          endpoint,
          result,
          incident: activeIncident,
          type: 'RECOVERED',
        });
      }
      return 'RESOLVED';
    }

    return 'NONE';
  }
}
