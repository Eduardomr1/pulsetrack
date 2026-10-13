import { db } from './db/drizzle.client';
import { DrizzleEndpointRepository } from './db/repositories/drizzle-endpoint.repository';
import { DrizzleHealthCheckRepository } from './db/repositories/drizzle-health-check.repository';
import { DrizzleIncidentRepository } from './db/repositories/drizzle-incident.repository';
import { DrizzleAlertChannelRepository } from './db/repositories/drizzle-alert-channel.repository';
import { HttpProberEngine } from './prober/http-prober.engine';
import { ExecuteProbeUseCase } from '../core/application/use-cases/execute-probe.use-case';
import { RegisterEndpointUseCase } from '../core/application/use-cases/register-endpoint.use-case';
import { PollingScheduler } from './scheduler/polling-scheduler';
import { AlertManagerService } from './notifiers/alert-manager.service';
import { AlertChannel } from '../core/domain/entities/alert-channel.entity';
import { telemetryEventBus } from './events/telemetry-event-bus';

// Singletons / Factory instances
export const endpointRepository = new DrizzleEndpointRepository(db);
export const healthCheckRepository = new DrizzleHealthCheckRepository(db);
export const incidentRepository = new DrizzleIncidentRepository(db);
export const alertChannelRepository = new DrizzleAlertChannelRepository(db);
export const alertManagerService = new AlertManagerService(db, { cooldownSeconds: 30 });

// Auto-register default channels if environment variables are configured
if (process.env.SLACK_WEBHOOK_URL) {
  alertManagerService.registerChannel(
    new AlertChannel({
      id: 'env-slack-channel',
      name: 'Slack Production Alerts',
      type: 'SLACK',
      config: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        mentionOnCritical: true,
      },
      events: ['DOWN', 'DEGRADED', 'RECOVERED'],
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
}

if (process.env.DISCORD_WEBHOOK_URL) {
  alertManagerService.registerChannel(
    new AlertChannel({
      id: 'env-discord-channel',
      name: 'Discord Ops Channel',
      type: 'DISCORD',
      config: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      },
      events: ['DOWN', 'DEGRADED', 'RECOVERED'],
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
}

if (process.env.INCIDENT_WEBHOOK_URL) {
  alertManagerService.registerChannel(
    new AlertChannel({
      id: 'env-generic-webhook',
      name: 'Generic Incident Webhook',
      type: 'WEBHOOK',
      config: {
        webhookUrl: process.env.INCIDENT_WEBHOOK_URL,
        secretKey: process.env.WEBHOOK_SECRET ?? 'pulsetrack-secret-key',
      },
      events: ['DOWN', 'DEGRADED', 'RECOVERED'],
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  );
}

import { StateTransitionDetector } from '../core/engine/state-transition-detector';

export const stateTransitionDetector = new StateTransitionDetector();

export const proberEngine = new HttpProberEngine(process.env.MONITOR_REGION ?? 'us-east-edge');

export const executeProbeUseCase = new ExecuteProbeUseCase(
  proberEngine,
  healthCheckRepository,
  incidentRepository,
  alertManagerService,
  telemetryEventBus,
  stateTransitionDetector
);

export const registerEndpointUseCase = new RegisterEndpointUseCase(
  endpointRepository,
  executeProbeUseCase
);

import { MultiRegionSimulatorService } from './prober/multi-region-simulator';

export const multiRegionSimulatorService = new MultiRegionSimulatorService(proberEngine);

export const pollingScheduler = new PollingScheduler(
  endpointRepository,
  executeProbeUseCase,
  10, // Max concurrent probes
  2000 // Ticks every 2s
);

export { telemetryEventBus };
