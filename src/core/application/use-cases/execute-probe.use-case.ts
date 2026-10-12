import { randomUUID } from 'node:crypto';
import { Endpoint } from '../../domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import { Incident } from '../../domain/entities/incident.entity';
import { IProberEngine } from '../../domain/ports/prober.port';
import { IHealthCheckRepository } from '../../domain/ports/health-check.repository';
import { IIncidentRepository } from '../../domain/ports/incident.repository';
import { IAlertNotifier } from '../../domain/ports/notifier.port';
import { TelemetryEventBus, telemetryEventBus } from '@/infrastructure/events/telemetry-event-bus';

export interface ExecuteProbeCommand {
  endpoint: Endpoint;
}

export class ExecuteProbeUseCase {
  constructor(
    private readonly prober: IProberEngine,
    private readonly healthCheckRepo: IHealthCheckRepository,
    private readonly incidentRepo: IIncidentRepository,
    private readonly notifier?: IAlertNotifier,
    private readonly eventBus: TelemetryEventBus = telemetryEventBus
  ) {}

  public async execute(command: ExecuteProbeCommand): Promise<HealthCheckResult> {
    const { endpoint } = command;

    // 1. Run low-level telemetry probe & assertion evaluation
    const result = await this.prober.probe(endpoint);

    // 2. Persist health check sample in time-series storage
    await this.healthCheckRepo.save(result);

    // 3. Incident State Machine & Notification Transition
    await this.handleIncidentLifecycle(endpoint, result);

    // 4. Emit probe result in real-time to event bus subscribers
    this.eventBus.emitProbeResult({ endpoint, result });

    return result;
  }

  private async handleIncidentLifecycle(
    endpoint: Endpoint,
    result: HealthCheckResult
  ): Promise<void> {
    const activeIncident = await this.incidentRepo.findActiveByEndpointId(endpoint.id);

    if (result.status.isDown()) {
      if (activeIncident) {
        activeIncident.incrementFailures();
        await this.incidentRepo.update(activeIncident);

        this.eventBus.emitIncident({
          incident: activeIncident,
          endpoint,
          endpointId: endpoint.id,
          type: 'ESCALATED',
        });
      } else {
        const newIncident = new Incident({
          id: randomUUID(),
          endpointId: endpoint.id,
          status: 'OPEN',
          severity: 'CRITICAL',
          startedAt: result.timestamp,
          summary: result.errorMessage ?? `Falló la sonda HTTP: ${result.failedAssertions.join(', ')}`,
          consecutiveFailures: 1,
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
      }
    } else if (result.status.isHealthy() && activeIncident) {
      // Endpoint has recovered!
      activeIncident.resolve(result.timestamp);
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
    }
  }
}
