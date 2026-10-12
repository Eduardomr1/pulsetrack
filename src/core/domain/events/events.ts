import { HealthCheckResult } from '../entities/health-check.entity';
import { Endpoint } from '../entities/endpoint.entity';

export interface HealthCheckedEvent {
  eventName: 'pulse.health_checked';
  occurredAt: Date;
  endpoint: Endpoint;
  result: HealthCheckResult;
}

export interface IncidentStateChangedEvent {
  eventName: 'pulse.incident_state_changed';
  occurredAt: Date;
  endpointId: string;
  type: 'TRIGGERED' | 'ESCALATED' | 'RESOLVED';
  summary: string;
}
