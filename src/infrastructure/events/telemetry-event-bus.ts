import { EventEmitter } from 'node:events';
import { Endpoint } from '../../core/domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../core/domain/entities/health-check.entity';
import { Incident } from '../../core/domain/entities/incident.entity';

export interface TelemetryProbeResultPayload {
  endpoint: Endpoint;
  result: HealthCheckResult;
}

export interface TelemetryIncidentPayload {
  incident: Incident;
  endpoint?: Endpoint;
  endpointId: string;
  type: 'TRIGGERED' | 'ESCALATED' | 'RESOLVED';
}

export class TelemetryEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  public emitProbeResult(payload: TelemetryProbeResultPayload): void {
    this.emit('telemetry.probe_result', payload);
  }

  public emitIncident(payload: TelemetryIncidentPayload): void {
    this.emit('telemetry.incident', payload);
  }
}

export const telemetryEventBus = new TelemetryEventBus();
